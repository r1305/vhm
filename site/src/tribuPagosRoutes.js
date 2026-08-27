const { Router } = require('express');
const pool = require('./db');
const { tribuAuthMiddleware } = require('./tribuAuthRoutes');
const {
  getCulqiConfig,
  buildExternalRef,
  resolvePayerEmail,
  extractCheckoutPayload,
  mapCulqiError,
  httpStatusForError,
  buildChargeBody,
  createCulqiCharge,
  fetchCulqiCharge,
  resolveChargeOutcome,
  validateCulqiCredentials,
  validateWebhookSignature,
  vaultCustomerCardSafe,
  extractVaultFromCharge,
} = require('./tribuCulqi');
const {
  activateNewSubscription,
  applyApprovedCharge,
  runRenovacionesSuscripciones,
} = require('./tribuRenovaciones');
const { recordCulqiTransaction } = require('./tribuCulqiTransactionLog');
const { getSavedCard, upsertSavedCard } = require('./tribuSavedCards');
const { authMiddleware } = require('./auth');

const router = Router();

function validateCulqiConfig(cfg) {
  const pk = String(cfg.public_key || '').trim();
  const sk = String(cfg.secret_key || '').trim();
  if (!pk || !sk) {
    throw new Error('Configura Public Key y Secret Key de Culqi en el panel de administración.');
  }
  validateCulqiCredentials(sk, pk, cfg.modo);
}

async function savePayerProfile(userId, identificationType, identificationNumber, billingEmail) {
  const billing = billingEmail
    ? String(billingEmail).trim().toLowerCase().slice(0, 150)
    : null;
  if (billing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing)) {
    throw new Error('Correo de facturación inválido');
  }
  if (!identificationType && !identificationNumber && !billing) return;
  await pool.execute(
    `INSERT INTO tribu_payer_profiles (tribu_user_id, identification_type, identification_number, billing_email)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       identification_type = COALESCE(VALUES(identification_type), identification_type),
       identification_number = COALESCE(VALUES(identification_number), identification_number),
       billing_email = COALESCE(VALUES(billing_email), billing_email)`,
    [
      userId,
      identificationType || null,
      identificationNumber ? String(identificationNumber).trim() : null,
      billing,
    ]
  );
}

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

function validateCronToken(req) {
  const secret = process.env.TRIBU_RENOVACION_CRON_SECRET;
  if (!secret) return false;
  const token = req.query.token || req.headers['x-cron-token'];
  if (!token || typeof token !== 'string') return false;
  const crypto = require('crypto');
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

async function fetchTribuUser(userId) {
  const [[user]] = await pool.execute(
    'SELECT nombre, apellido, email, telefono FROM tribu_users WHERE id = ? LIMIT 1',
    [userId]
  );
  return user || {};
}

// POST /api/tribu-pagos/procesar-pago — Culqi Checkout token o tarjeta guardada
router.post('/procesar-pago', tribuAuthMiddleware, async (req, res) => {
  try {
    const {
      suscripcion_id,
      billing_email: billingEmailRaw,
      auto_renovacion: autoRenovacionRaw,
      tarjeta_id: tarjetaIdRaw,
      ...rawForm
    } = req.body;
    if (!suscripcion_id) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const [[plan]] = await pool.execute(
      'SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = ?',
      [suscripcion_id]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const cfg = await getCulqiConfig();
    validateCulqiConfig(cfg);

    const tribuUser = await fetchTribuUser(req.tribuUser.id);
    const checkout = extractCheckoutPayload(rawForm);
    const wantsAutoRenew = autoRenovacionRaw !== false && autoRenovacionRaw !== '0' && autoRenovacionRaw !== 0;
    const tarjetaId = tarjetaIdRaw ? Number.parseInt(String(tarjetaIdRaw), 10) : null;

    let sourceId = checkout.tokenId;
    let vaultInfo = null;
    let vaultError = null;

    if (tarjetaId) {
      const saved = await getSavedCard(req.tribuUser.id, tarjetaId);
      if (!saved) return res.status(400).json({ error: 'Tarjeta guardada no encontrada' });
      sourceId = saved.culqi_card_id;
      vaultInfo = {
        customerId: saved.culqi_customer_id,
        cardId: saved.culqi_card_id,
        cardBrand: saved.culqi_card_brand,
        lastFour: saved.last_four_digits,
      };
    } else {
      if (!checkout.tokenId) {
        return res.status(400).json({ error: 'Token de Culqi requerido' });
      }
    }

    if (!checkout.identificationType || !checkout.identificationNumber) {
      return res.status(400).json({ error: 'Documento de identidad requerido (DNI, CE o RUC)' });
    }

    const identification = {
      type: checkout.identificationType,
      number: String(checkout.identificationNumber).trim(),
    };

    const email = resolvePayerEmail(
      checkout.email,
      req.tribuUser.email,
      cfg.modo,
      billingEmailRaw
    );
    const externalRef = buildExternalRef(req.tribuUser.id, plan.id);

    if (!tarjetaId && wantsAutoRenew) {
      const vaultResult = await vaultCustomerCardSafe({
        secretKey: cfg.secret_key,
        email,
        tokenId: checkout.tokenId,
        user: tribuUser,
        identification,
      });
      if (vaultResult.ok && vaultResult.vault?.cardId) {
        vaultInfo = vaultResult.vault;
        sourceId = vaultInfo.cardId;
        try {
          await upsertSavedCard(req.tribuUser.id, vaultInfo);
        } catch (saveErr) {
          console.error('[tribu-pagos procesar-pago] guardar tarjeta BD', saveErr.message);
        }
      } else {
        vaultError = vaultResult.errorMessage || 'No se pudo guardar la tarjeta en Culqi';
        console.warn('[tribu-pagos procesar-pago] vault falló:', vaultError);
      }
    }

    const chargeBody = buildChargeBody({
      plan,
      email,
      user: tribuUser,
      identification,
      externalRef,
      sourceId,
      description: plan.nombre,
    });

    const charge = await createCulqiCharge(cfg.secret_key, chargeBody);
    const outcome = resolveChargeOutcome(charge);
    let tribuSuscripcionId = null;

    if (!vaultInfo?.cardId) {
      const fromCharge = extractVaultFromCharge(charge);
      if (fromCharge?.cardId) {
        vaultInfo = fromCharge;
        if (wantsAutoRenew) {
          try {
            await upsertSavedCard(req.tribuUser.id, fromCharge);
          } catch (saveErr) {
            console.error('[tribu-pagos procesar-pago] guardar tarjeta BD (charge)', saveErr.message);
          }
        }
      }
    }

    const autoRenovacionActiva = wantsAutoRenew && !!vaultInfo?.cardId;

    if (outcome.status === 'approved') {
      try {
        await savePayerProfile(
          req.tribuUser.id,
          checkout.identificationType,
          checkout.identificationNumber,
          cfg.modo === 'produccion' ? email : null
        );
        tribuSuscripcionId = await activateNewSubscription({
          userId: req.tribuUser.id,
          planId: suscripcion_id,
          chargeId: outcome.charge_id,
          vigenciaDias: plan.vigencia_dias,
          customerId: vaultInfo?.customerId || null,
          cardId: vaultInfo?.cardId || null,
          cardBrand: vaultInfo?.cardBrand || null,
          autoRenovacion: autoRenovacionActiva,
        });
      } catch (dbErr) {
        console.error('[tribu-pagos procesar-pago] suscripcion', dbErr.message);
        return res.status(500).json({
          error: 'El pago fue aprobado pero no se pudo activar la suscripción. Contacta soporte.',
          charge_id: outcome.charge_id,
          status: outcome.status,
        });
      }
    }

    await recordCulqiTransaction(charge, {
      source: tarjetaId ? 'api_tarjeta_guardada' : 'api',
      tribuUserId: req.tribuUser.id,
      planId: suscripcion_id,
      tribuSuscripcionId,
      payerEmail: email,
    });

    res.json({
      ...outcome,
      auto_renovacion: autoRenovacionActiva,
      auto_renovacion_solicitada: wantsAutoRenew,
      tarjeta_guardada: !!vaultInfo?.cardId,
      vault_error: wantsAutoRenew && !autoRenovacionActiva ? vaultError : null,
    });
  } catch (err) {
    const msg = mapCulqiError(err);
    console.error('[tribu-pagos procesar-pago]', msg, err.status || '', err.payload || err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  }
});

async function handleCronRenovaciones(req, res) {
  if (!validateCronToken(req)) {
    return res.status(401).json({ error: 'Token inválido' });
  }
  try {
    const result = await runRenovacionesSuscripciones();
    res.json(result);
  } catch (err) {
    console.error('[tribu-pagos cron-renovaciones]', err.message);
    res.status(500).json({ error: 'Error al procesar renovaciones' });
  }
}

router.get('/cron-renovaciones', handleCronRenovaciones);
router.post('/cron-renovaciones', handleCronRenovaciones);

router.post('/webhook', async (req, res) => {
  try {
    if (!validateWebhookSignature(req)) {
      console.warn('[tribu-pagos webhook] firma inválida');
      return res.sendStatus(401);
    }

    const eventType = req.body?.type || req.body?.event || '';
    const chargeData = req.body?.data;
    const chargeId = chargeData?.id || req.body?.id;

    if (!chargeId && !chargeData) return res.sendStatus(200);

    const cfg = await getCulqiConfig();
    const isChargeSuccess =
      String(eventType).includes('charge.succeeded') ||
      String(eventType).includes('charge.success') ||
      chargeData?.outcome?.type === 'venta_exitosa';

    if (isChargeSuccess) {
      const charge = chargeData?.object === 'charge'
        ? chargeData
        : await fetchCulqiCharge(cfg.secret_key, chargeId);
      const applied = await applyApprovedCharge(charge);
      await recordCulqiTransaction(charge, {
        source: 'webhook',
        tribuSuscripcionId: applied?.tribuSuscripcionId ?? null,
        payerEmail: charge.email || null,
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[tribu-pagos webhook]', err.message);
    res.sendStatus(500);
  }
});

router.get('/transacciones', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status ? String(req.query.status).slice(0, 20) : null;

    const where = status ? 'WHERE t.status = ?' : '';
    const params = status ? [status, limit, offset] : [limit, offset];

    const [rows] = await pool.execute(
      `SELECT t.id, t.culqi_charge_id, t.tribu_user_id, t.suscripcion_plan_id,
              t.tribu_suscripcion_id, t.amount_cents, t.currency_code, t.status,
              t.outcome_type, t.outcome_code, t.merchant_message, t.user_message,
              t.external_reference, t.event_source, t.card_brand, t.card_last_four,
              t.payer_email_masked, t.culqi_created_at, t.created_at,
              u.email AS tribu_user_email, s.nombre AS plan_nombre
       FROM tribu_culqi_transactions t
       LEFT JOIN tribu_users u ON u.id = t.tribu_user_id
       LEFT JOIN suscripciones s ON s.id = t.suscripcion_plan_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM tribu_culqi_transactions t ${where}`,
      status ? [status] : []
    );

    res.json({ total, limit, offset, transacciones: rows });
  } catch (err) {
    console.error('[tribu-pagos transacciones]', err.message);
    res.status(500).json({ error: 'No se pudo listar transacciones' });
  }
});

module.exports = router;
