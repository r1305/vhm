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

function getBackUrl() {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!siteUrl || !/^https?:\/\//i.test(siteUrl)) return undefined;
  const base = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  return `${siteUrl}${base}/latribu`;
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

function recurringFromPlan(plan) {
  const dias = Number(plan.vigencia_dias) || 30;
  if (dias >= 28) return { frequency: 1, frequency_type: 'months' };
  return { frequency: dias, frequency_type: 'days' };
}

function buildPreapprovalBody({ plan, user, brick, externalRef, mpModo }) {
  const amount = Number.parseFloat(formatAmount(plan.precio));
  const email = resolvePayerEmail(brick.email, user.email, mpModo);
  const recurring = recurringFromPlan(plan);
  const body = {
    reason: `La Tribu · ${plan.nombre}`,
    external_reference: externalRef,
    payer_email: email,
    card_token_id: brick.token,
    status: 'authorized',
    auto_recurring: {
      ...recurring,
      transaction_amount: amount,
      currency_id: 'PEN',
    },
  };
  const backUrl = getBackUrl();
  if (backUrl) body.back_url = backUrl;
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

async function mpFetch(accessToken, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(parseMpPayloadErrors(payload) || 'Error en Mercado Pago');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function createMpPreapproval(accessToken, body) {
  return mpFetch(accessToken, 'https://api.mercadopago.com/preapproval', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function cancelMpPreapproval(accessToken, preapprovalId) {
  return mpFetch(accessToken, `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });
}

async function fetchMpPayment(accessToken, paymentId) {
  return mpFetch(accessToken, `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`);
}

function getPreapprovalIdFromPayment(payment) {
  return payment?.preapproval_id
    || payment?.metadata?.preapproval_id
    || payment?.point_of_interaction?.transaction_data?.subscription_id
    || null;
}

async function paymentAlreadyProcessed(paymentId) {
  const [[row]] = await pool.execute(
    'SELECT mp_payment_id FROM tribu_mp_payment_events WHERE mp_payment_id = ? LIMIT 1',
    [String(paymentId)]
  );
  return !!row;
}

async function recordPaymentEvent(paymentId, tribuSuscripcionId) {
  try {
    await pool.execute(
      'INSERT INTO tribu_mp_payment_events (mp_payment_id, tribu_suscripcion_id) VALUES (?, ?)',
      [String(paymentId), tribuSuscripcionId]
    );
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

async function findSubByPreapproval(preapprovalId) {
  const [[row]] = await pool.execute(
    `SELECT ts.id, ts.tribu_user_id, ts.fecha_fin, ts.created_at, s.vigencia_dias
     FROM tribu_suscripciones ts
     JOIN suscripciones s ON s.id = ts.suscripcion_id
     WHERE ts.mp_preapproval_id = ?
     ORDER BY ts.id DESC LIMIT 1`,
    [String(preapprovalId)]
  );
  return row || null;
}

async function activateSubscription(userId, planId, mpPaymentRef, vigenciaDias, preapprovalId = null) {
  const ref = String(mpPaymentRef);
  const preId = preapprovalId ? String(preapprovalId) : null;

  if (preId) {
    const [[existing]] = await pool.execute(
      'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND mp_preapproval_id = ? LIMIT 1',
      [userId, preId]
    );
    if (existing) return existing.id;
  } else {
    const [[existing]] = await pool.execute(
      'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND mp_payment_id = ? LIMIT 1',
      [userId, ref]
    );
    if (existing) return existing.id;
  }

  const dias = vigenciaDias || 30;
  await pool.execute(
    'UPDATE tribu_suscripciones SET activo = 0, auto_renovacion = 0 WHERE tribu_user_id = ? AND suscripcion_id = ?',
    [userId, planId]
  );
  const [result] = await pool.execute(
    `INSERT INTO tribu_suscripciones
      (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin, mp_payment_id, mp_preapproval_id, auto_renovacion)
     VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, 1)`,
    [userId, planId, dias, ref, preId]
  );
  await pool.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [userId]);
  return result.insertId;
}

async function extendSubscriptionPeriod(subId, vigenciaDias) {
  const dias = vigenciaDias || 30;
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET fecha_fin = DATE_ADD(GREATEST(fecha_fin, CURDATE()), INTERVAL ? DAY),
         activo = 1
     WHERE id = ?`,
    [dias, subId]
  );
}

async function applyApprovedPayment(payment) {
  const paymentId = payment?.id;
  if (!paymentId || payment.status !== 'approved') return;
  if (await paymentAlreadyProcessed(paymentId)) return;

  const preapprovalId = getPreapprovalIdFromPayment(payment);
  const { userId, planId } = parseExternalRef(payment.external_reference);

  let sub = preapprovalId ? await findSubByPreapproval(preapprovalId) : null;

  if (!sub && userId && planId) {
    const [[plan]] = await pool.execute(
      'SELECT vigencia_dias FROM suscripciones WHERE id = ?',
      [planId]
    );
    if (!plan) return;
    const subId = await activateSubscription(
      userId,
      planId,
      paymentId,
      plan.vigencia_dias,
      preapprovalId
    );
    await recordPaymentEvent(paymentId, subId);
    return;
  }

  if (!sub) return;

  const recorded = await recordPaymentEvent(paymentId, sub.id);
  if (!recorded) return;

  const dias = sub.vigencia_dias || 30;
  const [[fresh]] = await pool.execute(
    `SELECT TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS mins,
            DATEDIFF(fecha_fin, CURDATE()) AS dias_rest
     FROM tribu_suscripciones WHERE id = ? LIMIT 1`,
    [sub.id]
  );
  if (fresh && fresh.mins <= 10 && fresh.dias_rest >= dias - 3) {
    return;
  }

  await extendSubscriptionPeriod(sub.id, dias);
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

// POST /api/tribu-pagos/procesar-pago — suscripción recurrente Mercado Pago (preapproval)
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

    const preapproval = await createMpPreapproval(cfg.access_token, buildPreapprovalBody({
      plan,
      user: req.tribuUser,
      brick,
      externalRef,
      mpModo: cfg.modo,
    }));

    if (preapproval.status === 'authorized') {
      try {
        await activateSubscription(
          req.tribuUser.id,
          suscripcion_id,
          preapproval.id,
          plan.vigencia_dias,
          preapproval.id
        );
      } catch (dbErr) {
        console.error('[tribu-pagos procesar-pago] suscripcion', dbErr.message);
        return res.status(500).json({
          error: 'La suscripción fue autorizada pero no se pudo activar localmente. Contacta soporte.',
          preapproval_id: preapproval.id,
          status: preapproval.status,
        });
      }
      return res.json({
        status: 'approved',
        preapproval_id: preapproval.id,
        next_payment_date: preapproval.next_payment_date || null,
        recurring: true,
      });
    }

    if (preapproval.status === 'pending') {
      return res.json({
        status: 'pending',
        preapproval_id: preapproval.id,
        order_status: 'action_required',
        recurring: true,
      });
    }

    return res.json({
      status: 'rejected',
      status_detail: preapproval.status,
      preapproval_id: preapproval.id,
    });
  } catch (err) {
    const msg = mapMpError(err);
    console.error('[tribu-pagos procesar-pago]', msg, err.status || '', err.payload || err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  }
});

// POST /api/tribu-pagos/cancelar-renovacion
router.post('/cancelar-renovacion', tribuAuthMiddleware, async (req, res) => {
  try {
    const suscripcionId = Number.parseInt(req.body.suscripcion_id, 10);
    if (!suscripcionId) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const [[row]] = await pool.execute(
      `SELECT ts.id, ts.mp_preapproval_id, ts.auto_renovacion,
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

    if (row.mp_preapproval_id) {
      const cfg = await getMpConfig();
      await cancelMpPreapproval(cfg.access_token, row.mp_preapproval_id);
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
    const msg = mapMpError(err);
    console.error('[tribu-pagos cancelar-renovacion]', msg);
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
    const resourceId = data?.id;
    if (!resourceId) return res.sendStatus(200);

    const cfg = await getMpConfig();
    const actionStr = String(action || '');

    const isPaymentEvent =
      type === 'payment' || actionStr.startsWith('payment.');
    const isPreapprovalEvent =
      type === 'subscription_preapproval' || type === 'preapproval' || actionStr.startsWith('preapproval.');

    if (isPaymentEvent) {
      const payment = await fetchMpPayment(cfg.access_token, resourceId);
      await applyApprovedPayment(payment);
    } else if (isPreapprovalEvent) {
      const preapproval = await mpFetch(
        cfg.access_token,
        `https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`
      );
      if (preapproval.status === 'cancelled') {
        await pool.execute(
          'UPDATE tribu_suscripciones SET auto_renovacion = 0, cancelada_at = COALESCE(cancelada_at, NOW()) WHERE mp_preapproval_id = ?',
          [String(resourceId)]
        );
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[tribu-pagos webhook]', err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
