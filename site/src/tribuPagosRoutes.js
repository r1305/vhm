const { Router } = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { tribuAuthMiddleware } = require('./tribuAuthRoutes');
const {
  getMpConfig,
  buildExternalRef,
  getWebhookUrl,
  resolvePayerEmail,
  extractBrickPayload,
  mapMpError,
  httpStatusForError,
  buildOrderBody,
  createMpOrder,
  fetchMpOrder,
  resolvePaymentOutcome,
  vaultCustomerCard,
  validateMpCredentialsForModo,
} = require('./tribuMpOrders');
const {
  activateNewSubscription,
  applyApprovedOrder,
  runRenovacionesSuscripciones,
} = require('./tribuRenovaciones');

const router = Router();

function validateMpCredentials(cfg) {
  const pk = String(cfg.public_key || '').trim();
  const at = String(cfg.access_token || '').trim();
  if (!pk || !at) {
    throw new Error('Configura Public Key y Access Token de Mercado Pago en el panel de administración.');
  }
  const mpKey = /^(APP_USR-|TEST-)/;
  if (!mpKey.test(pk)) {
    throw new Error('Public Key inválida. Debe empezar con APP_USR- (credenciales actuales) o TEST- (legado).');
  }
  if (!mpKey.test(at)) {
    throw new Error('Access Token inválido. Debe empezar con APP_USR- (credenciales actuales) o TEST- (legado).');
  }
  const pkLegacy = pk.startsWith('TEST-');
  const atLegacy = at.startsWith('TEST-');
  if (pkLegacy !== atLegacy) {
    throw new Error('Public Key y Access Token deben ser del mismo tipo (ambos APP_USR- o ambos TEST-).');
  }
}

async function savePayerProfile(userId, identificationType, identificationNumber) {
  if (!identificationType || !identificationNumber) return;
  await pool.execute(
    `INSERT INTO tribu_payer_profiles (tribu_user_id, identification_type, identification_number)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE identification_type = VALUES(identification_type),
                             identification_number = VALUES(identification_number)`,
    [userId, identificationType, String(identificationNumber).trim()]
  );
}

function validateWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature || !xRequestId) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key.trim(), value.trim()];
    })
  );
  const ts = parts.ts;
  const received = parts.v1;
  if (!ts || !received) return false;

  const dataId = req.body?.data?.id;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

function validateCronToken(req) {
  const secret = process.env.TRIBU_RENOVACION_CRON_SECRET;
  if (!secret) return false;
  const token = req.query.token || req.headers['x-cron-token'];
  if (!token || typeof token !== 'string') return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

// POST /api/tribu-pagos/procesar-pago — Card Brick + Orders API + tarjeta guardada
router.post('/procesar-pago', tribuAuthMiddleware, async (req, res) => {
  try {
    const { suscripcion_id, ...rawForm } = req.body;
    if (!suscripcion_id) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const brick = extractBrickPayload(rawForm);
    if (!brick.token || !brick.paymentMethodId) {
      return res.status(400).json({ error: 'Datos de tarjeta incompletos' });
    }
    if (!brick.identificationType || !brick.identificationNumber) {
      return res.status(400).json({ error: 'Documento de identidad requerido (DNI, CE o RUC)' });
    }

    const [[plan]] = await pool.execute(
      'SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = ?',
      [suscripcion_id]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const cfg = await getMpConfig();
    validateMpCredentials(cfg);
    await validateMpCredentialsForModo(cfg.access_token, cfg.public_key, cfg.modo);

    const email = resolvePayerEmail(brick.email, req.tribuUser.email, cfg.modo);
    const externalRef = buildExternalRef(req.tribuUser.id, plan.id);
    const callbackUrl = getWebhookUrl();
    const identification = {
      type: brick.identificationType,
      number: String(brick.identificationNumber).trim(),
    };

    const useCardVault = cfg.modo === 'produccion';
    let customerId = null;
    let cardId = null;

    if (useCardVault) {
      const vault = await vaultCustomerCard({
        accessToken: cfg.access_token,
        mpModo: cfg.modo,
        email,
        token: brick.token,
      });
      customerId = vault.customerId;
      cardId = vault.cardId;
    }

    const orderBody = buildOrderBody({
      plan,
      email,
      identification,
      externalRef,
      callbackUrl,
      paymentMethodId: brick.paymentMethodId,
      paymentType: brick.paymentType,
      token: useCardVault ? undefined : brick.token,
      customerId,
      cardId,
    });

    const orderResult = await createMpOrder(cfg.access_token, orderBody, cfg.modo);
    const outcome = resolvePaymentOutcome(orderResult);

    if (outcome.status === 'approved') {
      try {
        await savePayerProfile(req.tribuUser.id, brick.identificationType, brick.identificationNumber);
        await activateNewSubscription({
          userId: req.tribuUser.id,
          planId: suscripcion_id,
          orderId: outcome.order_id,
          paymentId: outcome.payment_id,
          customerId,
          cardId,
          mpCardBrand: brick.paymentMethodId,
          vigenciaDias: plan.vigencia_dias,
        });
      } catch (dbErr) {
        console.error('[tribu-pagos procesar-pago] suscripcion', dbErr.message);
        return res.status(500).json({
          error: 'El pago fue aprobado pero no se pudo activar la suscripción. Contacta soporte.',
          order_id: outcome.order_id,
          status: outcome.status,
        });
      }
    }

    res.json({
      ...outcome,
      recurring: useCardVault,
      auto_renovacion: outcome.status === 'approved' && useCardVault,
    });
  } catch (err) {
    const msg = mapMpError(err);
    console.error('[tribu-pagos procesar-pago]', msg, err.status || '', err.payload || err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  }
});

// POST /api/tribu-pagos/cancelar-renovacion — solo desactiva flag local (Orders API)
router.post('/cancelar-renovacion', tribuAuthMiddleware, async (req, res) => {
  try {
    const suscripcionId = Number.parseInt(req.body.suscripcion_id, 10);
    if (!suscripcionId) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const [[row]] = await pool.execute(
      `SELECT ts.id, ts.auto_renovacion, ts.mp_card_id,
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

// GET|POST /api/tribu-pagos/cron-renovaciones?token=... — cobros automáticos (cPanel cron)
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

// POST /api/tribu-pagos/webhook — eventos Orders (+ Pagos como respaldo)
router.post('/webhook', async (req, res) => {
  try {
    if (!validateWebhookSignature(req)) {
      console.warn('[tribu-pagos webhook] firma inválida');
      return res.sendStatus(401);
    }

    const { type, data, action } = req.body;
    const resourceId = data?.id;
    if (!resourceId) return res.sendStatus(200);

    const cfg = await getMpConfig();
    const actionStr = String(action || '');

    const isOrderEvent =
      type === 'order' || actionStr.startsWith('order.') || req.query?.topic === 'order';
    const isPaymentEvent = type === 'payment' || actionStr.startsWith('payment.');

    if (isOrderEvent) {
      const orderResult = await fetchMpOrder(cfg.access_token, resourceId, cfg.modo);
      await applyApprovedOrder(orderResult);
    } else if (isPaymentEvent) {
      const resPay = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`,
        { headers: { Authorization: `Bearer ${cfg.access_token}` } }
      );
      const payment = await resPay.json().catch(() => ({}));
      if (payment.status === 'approved') {
        const orderId = payment.order?.id || payment.metadata?.order_id;
        if (orderId) {
          const orderResult = await fetchMpOrder(cfg.access_token, orderId, cfg.modo);
          await applyApprovedOrder(orderResult);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[tribu-pagos webhook]', err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
