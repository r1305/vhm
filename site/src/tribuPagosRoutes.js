const { Router } = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { tribuAuthMiddleware } = require('./tribuAuthRoutes');

const router = Router();

async function getMpConfig() {
  const [rows] = await pool.execute(
    'SELECT activo, access_token, modo FROM config_mercadopago WHERE id = 1'
  );
  const cfg = rows[0];
  if (!cfg || !cfg.activo || !cfg.access_token) {
    throw new Error('MercadoPago no está configurado o activo');
  }
  return cfg;
}

function formatAmount(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Monto inválido');
  return n.toFixed(2);
}

function buildExternalRef(userId, planId) {
  return `tribu-${userId}-${planId}-${Date.now()}`;
}

function parseExternalRef(ref) {
  const raw = String(ref || '');
  const parts = raw.includes('-') ? raw.split('-') : raw.split('_');
  return {
    userId: Number.parseInt(parts[1] || '0', 10),
    planId: Number.parseInt(parts[2] || '0', 10),
  };
}

function getWebhookUrl() {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!siteUrl || !/^https?:\/\//i.test(siteUrl)) return undefined;
  return `${siteUrl}/api/tribu-pagos/webhook`;
}

function getSandboxPayerEmail() {
  const email = (process.env.MP_SANDBOX_PAYER_EMAIL || 'test_user_123456789@testuser.com')
    .trim()
    .toLowerCase();
  return email.includes('@testuser.com') ? email : 'test_user_123456789@testuser.com';
}

function resolvePayerEmail(brickEmail, userEmail, mpModo) {
  if (mpModo === 'sandbox') return getSandboxPayerEmail();
  const email = String(brickEmail || userEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Email del pagador requerido');
  return email;
}

function extractBrickPayload(body) {
  const payer = body.payer || {};
  const identification = payer.identification || body.identification || {};
  const paymentTypeId = body.payment_type_id || body.paymentTypeId || 'credit_card';
  return {
    token: body.token,
    paymentMethodId: body.payment_method_id || body.paymentMethodId,
    paymentType: paymentTypeId === 'debit_card' ? 'debit_card' : 'credit_card',
    installments: Number(body.installments || 1),
    email: payer.email || body.email,
    identificationType: identification.type || body.identificationType || body.identification_type,
    identificationNumber: identification.number || body.identificationNumber || body.identification_number,
  };
}

function resolvePaymentOutcome(orderResult) {
  const payment = orderResult?.transactions?.payments?.[0];
  const paymentStatus = payment?.status;
  const orderStatus = orderResult?.status;

  if (paymentStatus === 'approved' || orderStatus === 'processed') {
    return {
      status: 'approved',
      status_detail: payment?.status_detail || orderResult?.status_detail || null,
      order_id: orderResult?.id || null,
      payment_id: payment?.id || null,
      order_status: orderStatus || null,
    };
  }

  if (
    paymentStatus === 'pending' ||
    paymentStatus === 'in_process' ||
    orderStatus === 'action_required' ||
    orderStatus === 'created'
  ) {
    return {
      status: paymentStatus || 'pending',
      status_detail: payment?.status_detail || orderResult?.status_detail || null,
      order_id: orderResult?.id || null,
      payment_id: payment?.id || null,
      order_status: orderStatus || null,
    };
  }

  return {
    status: paymentStatus || orderStatus || 'rejected',
    status_detail: payment?.status_detail || orderResult?.status_detail || null,
    order_id: orderResult?.id || null,
    payment_id: payment?.id || null,
    order_status: orderStatus || null,
  };
}

function isOrderPaid(orderResult) {
  const outcome = resolvePaymentOutcome(orderResult);
  return outcome.status === 'approved';
}

async function activateSubscription(userId, planId, mpRef, vigenciaDias) {
  const ref = String(mpRef);
  const [[existing]] = await pool.execute(
    'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND mp_payment_id = ? LIMIT 1',
    [userId, ref]
  );
  if (existing) return false;

  const dias = vigenciaDias || 30;
  await pool.execute(
    'UPDATE tribu_suscripciones SET activo = 0 WHERE tribu_user_id = ? AND suscripcion_id = ?',
    [userId, planId]
  );
  await pool.execute(
    `INSERT INTO tribu_suscripciones (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin, mp_payment_id)
     VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?)`,
    [userId, planId, dias, ref]
  );
  await pool.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [userId]);
  return true;
}

function buildOrderBody({ plan, user, brick, externalRef, callbackUrl, mpModo }) {
  const amount = formatAmount(plan.precio);
  const email = resolvePayerEmail(brick.email, user.email, mpModo);
  const payer = { email };
  if (brick.identificationType && brick.identificationNumber) {
    payer.identification = {
      type: brick.identificationType,
      number: String(brick.identificationNumber).trim(),
    };
  } else {
    throw new Error('Documento de identidad requerido (DNI, CE o RUC)');
  }

  const body = {
    type: 'online',
    processing_mode: 'automatic',
    total_amount: amount,
    external_reference: externalRef,
    currency: 'PEN',
    description: plan.nombre,
    payer,
    transactions: {
      payments: [{
        amount,
        payment_method: {
          id: brick.paymentMethodId,
          type: brick.paymentType || 'credit_card',
          token: brick.token,
          installments: brick.installments > 0 ? brick.installments : 1,
          statement_descriptor: 'La Tribu VHM',
        },
      }],
    },
    items: [{
      title: plan.nombre,
      unit_price: amount,
      quantity: 1,
      category_id: 'services',
    }],
  };

  if (callbackUrl) {
    body.config = { online: { callback_url: callbackUrl } };
  }

  return body;
}

function parseMpPayloadErrors(payload) {
  const list = payload?.errors || payload?.cause || [];
  if (!Array.isArray(list) || !list.length) return null;
  const parts = list.flatMap((entry) => {
    const chunk = [entry.message, entry.description, entry.code].filter(Boolean);
    if (Array.isArray(entry.details)) chunk.push(...entry.details);
    return chunk;
  });
  return parts.length ? parts.join(' · ') : null;
}

function mapMpError(err) {
  const fromPayload = parseMpPayloadErrors(err?.payload);
  if (fromPayload) return fromPayload;

  const causes = Array.isArray(err?.causes) ? err.causes : [];
  if (causes.length) {
    const parts = causes
      .map((c) => c.description || c.message || c.code)
      .filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  const legacy = err?.cause?.[0] || err?.cause;
  return legacy?.description || legacy?.message || err?.message || 'Error al procesar el pago';
}

function httpStatusForError(err) {
  const msg = String(err?.message || '');
  if (msg.includes('requerido') || msg.includes('inválido') || msg.includes('incompletos')) return 400;
  const status = Number(err?.status);
  if (status === 401 || status === 403) return 502;
  if (status >= 400 && status < 500) return status;
  return 500;
}

async function createMpOrder(accessToken, body) {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));

  // Orders API: 402 incluye la orden creada con pago fallido en `data`
  if (res.status === 402 && payload?.data) {
    return payload.data;
  }

  if (!res.ok) {
    const err = new Error(parseMpPayloadErrors(payload) || 'Error al procesar el pago');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload?.data || payload;
}

async function fetchMpOrder(accessToken, orderId) {
  const res = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(parseMpPayloadErrors(payload) || 'Error al consultar la orden');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload?.data || payload;
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

// POST /api/tribu-pagos/procesar-pago — Card Brick + Orders API (POST /v1/orders)
router.post('/procesar-pago', tribuAuthMiddleware, async (req, res) => {
  try {
    const { suscripcion_id, ...rawForm } = req.body;
    if (!suscripcion_id) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const brick = extractBrickPayload(rawForm);
    if (!brick.token || !brick.paymentMethodId) {
      return res.status(400).json({ error: 'Datos de tarjeta incompletos' });
    }

    const [[plan]] = await pool.execute(
      'SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = ?',
      [suscripcion_id]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const cfg = await getMpConfig();
    const externalRef = buildExternalRef(req.tribuUser.id, plan.id);
    const callbackUrl = getWebhookUrl();

    const result = await createMpOrder(cfg.access_token, buildOrderBody({
      plan,
      user: req.tribuUser,
      brick,
      externalRef,
      callbackUrl,
      mpModo: cfg.modo,
    }));

    const outcome = resolvePaymentOutcome(result);
    if (outcome.status === 'approved') {
      try {
        await activateSubscription(
          req.tribuUser.id,
          suscripcion_id,
          outcome.order_id || externalRef,
          plan.vigencia_dias
        );
      } catch (dbErr) {
        console.error('[tribu-pagos procesar-pago] suscripcion', dbErr.message);
        return res.status(500).json({
          error: 'El pago fue aprobado pero no se pudo activar la suscripcion. Contacta soporte con tu comprobante.',
          order_id: outcome.order_id,
          status: outcome.status,
        });
      }
    }

    res.json(outcome);
  } catch (err) {
    const msg = mapMpError(err);
    console.error('[tribu-pagos procesar-pago]', msg, err.status || '', err.payload || err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  }
});

// POST /api/tribu-pagos/webhook
router.post('/webhook', async (req, res) => {
  try {
    if (!validateWebhookSignature(req)) {
      console.warn('[tribu-pagos webhook] firma inválida');
      return res.sendStatus(401);
    }

    const { type, data, action } = req.body;
    const orderId = data?.id;
    if (!orderId) return res.sendStatus(200);

    const isOrderEvent =
      type === 'order' ||
      String(action || '').startsWith('order.') ||
      req.query?.topic === 'order';

    if (!isOrderEvent) return res.sendStatus(200);

    const cfg = await getMpConfig();
    const result = await fetchMpOrder(cfg.access_token, orderId);
    if (!isOrderPaid(result)) return res.sendStatus(200);

    const { userId, planId } = parseExternalRef(result.external_reference);
    if (!userId || !planId) return res.sendStatus(200);

    const [[plan]] = await pool.execute(
      'SELECT vigencia_dias FROM suscripciones WHERE id = ?',
      [planId]
    );
    if (!plan) return res.sendStatus(200);

    await activateSubscription(userId, planId, orderId, plan.vigencia_dias);
    res.sendStatus(200);
  } catch (err) {
    console.error('[tribu-pagos webhook]', err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
