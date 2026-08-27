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
  vaultCustomerCardSafe,
  validateCulqiCredentials,
  validateWebhookSignature,
} = require('./tribuCulqi');
const {
  getSavedCardForUser,
  upsertSavedCard,
} = require('./tribuSavedCards');
const {
  activateNewSubscription,
  applyApprovedCharge,
  runRenovacionesSuscripciones,
} = require('./tribuRenovaciones');

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

function parseBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

async function loadPayerIdentification(userId) {
  const [[profile]] = await pool.execute(
    `SELECT identification_type, identification_number
     FROM tribu_payer_profiles WHERE tribu_user_id = ? LIMIT 1`,
    [userId]
  );
  if (!profile?.identification_type || !profile?.identification_number) return null;
  return {
    type: profile.identification_type,
    number: String(profile.identification_number).trim(),
  };
}

async function fetchTribuUser(userId) {
  const [[user]] = await pool.execute(
    'SELECT nombre, apellido, email, telefono FROM tribu_users WHERE id = ? LIMIT 1',
    [userId]
  );
  return user || {};
}

// POST /api/tribu-pagos/procesar-pago — Culqi Checkout token + tarjeta guardada
router.post('/procesar-pago', tribuAuthMiddleware, async (req, res) => {
  try {
    const {
      suscripcion_id,
      billing_email: billingEmailRaw,
      guardar_tarjeta: guardarTarjetaRaw,
      tarjeta_id: tarjetaIdRaw,
      ...rawForm
    } = req.body;
    if (!suscripcion_id) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const wantsSaveCard = parseBool(guardarTarjetaRaw);
    const savedCardRowId = tarjetaIdRaw ? Number.parseInt(tarjetaIdRaw, 10) : null;

    const [[plan]] = await pool.execute(
      'SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = ?',
      [suscripcion_id]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const cfg = await getCulqiConfig();
    validateCulqiConfig(cfg);

    const tribuUser = await fetchTribuUser(req.tribuUser.id);
    let checkout = null;
    let identification = null;
    let sourceId = null;
    let customerId = null;
    let cardId = null;
    let culqiCardBrand = null;
    let vaultMeta = null;
    let usedSavedCard = false;

    if (savedCardRowId) {
      const saved = await getSavedCardForUser(req.tribuUser.id, savedCardRowId);
      if (!saved) return res.status(404).json({ error: 'Tarjeta guardada no encontrada' });
      identification = await loadPayerIdentification(req.tribuUser.id);
      if (!identification) {
        return res.status(400).json({
          error: 'Para pagar con una tarjeta guardada necesitas haber registrado tu documento (DNI, CE o RUC) en un pago anterior.',
        });
      }
      customerId = saved.culqi_customer_id;
      cardId = saved.culqi_card_id;
      culqiCardBrand = saved.culqi_card_brand;
      sourceId = saved.culqi_card_id;
      usedSavedCard = true;
    } else {
      checkout = extractCheckoutPayload(rawForm);
      if (!checkout.tokenId) {
        return res.status(400).json({ error: 'Token de Culqi requerido' });
      }
      if (!checkout.identificationType || !checkout.identificationNumber) {
        return res.status(400).json({ error: 'Documento de identidad requerido (DNI, CE o RUC)' });
      }
      identification = {
        type: checkout.identificationType,
        number: String(checkout.identificationNumber).trim(),
      };

      const emailForVault = resolvePayerEmail(
        checkout.email,
        req.tribuUser.email,
        cfg.modo,
        billingEmailRaw
      );

      if (wantsSaveCard) {
        const vaultResult = await vaultCustomerCardSafe({
          secretKey: cfg.secret_key,
          email: emailForVault,
          tokenId: checkout.tokenId,
          user: tribuUser,
          identification,
        });
        if (vaultResult.ok) {
          customerId = vaultResult.vault.customerId;
          cardId = vaultResult.vault.cardId;
          culqiCardBrand = vaultResult.vault.cardBrand;
          vaultMeta = vaultResult.vault;
          sourceId = vaultResult.vault.cardId;
        } else {
          sourceId = checkout.tokenId;
        }
      } else {
        sourceId = checkout.tokenId;
      }
    }

    const email = resolvePayerEmail(
      checkout?.email,
      req.tribuUser.email,
      cfg.modo,
      billingEmailRaw
    );
    const externalRef = buildExternalRef(req.tribuUser.id, plan.id);

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
    const hasVaultForRenewal = !!(customerId && cardId);

    if (outcome.status === 'approved') {
      try {
        if (checkout) {
          await savePayerProfile(
            req.tribuUser.id,
            checkout.identificationType,
            checkout.identificationNumber,
            cfg.modo === 'produccion' ? email : null
          );
        }
        if (vaultMeta && wantsSaveCard) {
          await upsertSavedCard(req.tribuUser.id, vaultMeta);
        }
        await activateNewSubscription({
          userId: req.tribuUser.id,
          planId: suscripcion_id,
          chargeId: outcome.charge_id,
          customerId,
          cardId,
          culqiCardBrand,
          vigenciaDias: plan.vigencia_dias,
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

    res.json({
      ...outcome,
      auto_renovacion: outcome.status === 'approved' && hasVaultForRenewal,
      tarjeta_guardada: !!(vaultMeta && wantsSaveCard) || usedSavedCard,
      vault_intentado: wantsSaveCard && !usedSavedCard,
      vault_ok: !!(vaultMeta && wantsSaveCard),
    });
  } catch (err) {
    const msg = mapCulqiError(err);
    console.error('[tribu-pagos procesar-pago]', msg, err.status || '', err.payload || err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  }
});

router.post('/cancelar-renovacion', tribuAuthMiddleware, async (req, res) => {
  try {
    const suscripcionId = Number.parseInt(req.body.suscripcion_id, 10);
    if (!suscripcionId) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const [[row]] = await pool.execute(
      `SELECT ts.id, ts.auto_renovacion, ts.culqi_card_id,
              (ts.activo = 1 AND ts.fecha_fin >= CURDATE()) AS vigente
       FROM tribu_suscripciones ts
       WHERE ts.id = ? AND ts.tribu_user_id = ? LIMIT 1`,
      [suscripcionId, req.tribuUser.id]
    );
    if (!row) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (!row.vigente) return res.status(400).json({ error: 'Esta suscripción ya no está vigente' });
    if (!row.auto_renovacion) {
      return res.status(400).json({ error: 'La autorenovación ya está cancelada' });
    }

    await pool.execute(
      'UPDATE tribu_suscripciones SET auto_renovacion = 0, cancelada_at = NOW() WHERE id = ?',
      [suscripcionId]
    );

    res.json({
      ok: true,
      message: 'Autorenovación cancelada. Mantendrás acceso hasta la fecha de vencimiento.',
    });
  } catch (err) {
    console.error('[tribu-pagos cancelar-renovacion]', err.message);
    res.status(500).json({ error: 'No se pudo cancelar la autorenovación' });
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
      await applyApprovedCharge(charge);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[tribu-pagos webhook]', err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
