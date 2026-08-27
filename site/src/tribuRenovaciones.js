/**
 * Suscripciones La Tribu: activación, renovación automática (Orders API + tarjeta guardada).
 */
const pool = require('./db');
const {
  getMpConfig,
  buildRenewExternalRef,
  buildOrderBody,
  createMpOrder,
  getWebhookUrl,
  resolvePaymentOutcome,
  isOrderPaid,
  parseExternalRef,
} = require('./tribuMpOrders');

async function paymentAlreadyProcessed(orderId) {
  const [[row]] = await pool.execute(
    'SELECT mp_payment_id FROM tribu_mp_payment_events WHERE mp_payment_id = ? LIMIT 1',
    [String(orderId)]
  );
  return !!row;
}

async function recordPaymentEvent(orderId, tribuSuscripcionId) {
  try {
    await pool.execute(
      'INSERT INTO tribu_mp_payment_events (mp_payment_id, tribu_suscripcion_id) VALUES (?, ?)',
      [String(orderId), tribuSuscripcionId]
    );
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

async function activateNewSubscription({
  userId,
  planId,
  orderId,
  paymentId,
  customerId,
  cardId,
  mpCardBrand,
  vigenciaDias,
}) {
  const ref = String(orderId || paymentId);
  const [[existing]] = await pool.execute(
    'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND mp_order_id = ? LIMIT 1',
    [userId, ref]
  );
  if (existing) return existing.id;

  const dias = vigenciaDias || 30;
  await pool.execute(
    'UPDATE tribu_suscripciones SET activo = 0, auto_renovacion = 0 WHERE tribu_user_id = ? AND suscripcion_id = ?',
    [userId, planId]
  );
  const [result] = await pool.execute(
    `INSERT INTO tribu_suscripciones
      (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin,
       mp_payment_id, mp_order_id, mp_customer_id, mp_card_id, mp_card_brand, auto_renovacion, renovacion_intentos)
     VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?, ?, 1, 0)`,
    [userId, planId, dias, String(paymentId || ref), ref, customerId, cardId, mpCardBrand || null]
  );
  await pool.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [userId]);
  await recordPaymentEvent(ref, result.insertId);
  return result.insertId;
}

async function extendSubscriptionRenewal(tribuSubId, orderId, paymentId, vigenciaDias) {
  const ref = String(orderId || paymentId);
  if (await paymentAlreadyProcessed(ref)) return false;

  const dias = vigenciaDias || 30;
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET fecha_fin = DATE_ADD(GREATEST(fecha_fin, CURDATE()), INTERVAL ? DAY),
         activo = 1,
         mp_order_id = ?,
         mp_payment_id = ?,
         renovacion_intentos = 0,
         next_renovacion_intento = NULL
     WHERE id = ?`,
    [dias, ref, String(paymentId || ref), tribuSubId]
  );
  await recordPaymentEvent(ref, tribuSubId);
  return true;
}

async function markRenewalFailed(tribuSubId, errorMsg) {
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET renovacion_intentos = LEAST(renovacion_intentos + 1, 10),
         next_renovacion_intento = DATE_ADD(NOW(), INTERVAL 1 DAY)
     WHERE id = ?`,
    [tribuSubId]
  );
  console.error(`[tribu-renovacion] fallo sub=${tribuSubId}: ${errorMsg}`);
}

async function applyApprovedOrder(orderResult) {
  const outcome = resolvePaymentOutcome(orderResult);
  if (outcome.status !== 'approved') return;
  const orderId = outcome.order_id;
  if (!orderId || await paymentAlreadyProcessed(orderId)) return;

  const parsed = parseExternalRef(orderResult.external_reference);

  if (parsed.type === 'renew' && parsed.tribuSubId) {
    const [[sub]] = await pool.execute(
      `SELECT ts.id, s.vigencia_dias
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       WHERE ts.id = ? LIMIT 1`,
      [parsed.tribuSubId]
    );
    if (sub) {
      await extendSubscriptionRenewal(sub.id, orderId, outcome.payment_id, sub.vigencia_dias);
    }
    return;
  }

  const { userId, planId } = parsed;
  if (!userId || !planId) return;

  const [[plan]] = await pool.execute(
    'SELECT vigencia_dias FROM suscripciones WHERE id = ?',
    [planId]
  );
  if (!plan) return;

  const [[existingSub]] = await pool.execute(
    'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND mp_order_id = ? LIMIT 1',
    [userId, String(orderId)]
  );
  if (existingSub) {
    await recordPaymentEvent(orderId, existingSub.id);
    return;
  }

  await activateNewSubscription({
    userId,
    planId,
    orderId,
    paymentId: outcome.payment_id,
    customerId: null,
    cardId: null,
    vigenciaDias: plan.vigencia_dias,
  });
}

async function procesarRenovacionSuscripcion(row, cfg) {
  if (!row.mp_customer_id || !row.mp_card_id) {
    throw new Error('Sin tarjeta guardada para renovación');
  }

  const externalRef = buildRenewExternalRef(row.id);
  const identification = row.identification_type && row.identification_number
    ? { type: row.identification_type, number: row.identification_number }
    : null;

  const orderBody = buildOrderBody({
    plan: { nombre: row.plan_nombre, precio: row.precio },
    email: row.email,
    identification,
    externalRef,
    callbackUrl: getWebhookUrl(),
    paymentMethodId: row.mp_card_brand || 'visa',
    paymentType: 'credit_card',
    customerId: row.mp_customer_id,
    cardId: row.mp_card_id,
  });

  const orderResult = await createMpOrder(cfg.access_token, orderBody, cfg.modo);
  const outcome = resolvePaymentOutcome(orderResult);

  if (outcome.status === 'approved') {
    await extendSubscriptionRenewal(row.id, outcome.order_id, outcome.payment_id, row.vigencia_dias);
    return { id: row.id, ok: true, order_id: outcome.order_id };
  }

  await markRenewalFailed(row.id, outcome.status_detail || outcome.status);
  return { id: row.id, ok: false, status: outcome.status, detail: outcome.status_detail };
}

async function runRenovacionesSuscripciones() {
  let cfg;
  try {
    cfg = await getMpConfig();
  } catch {
    return { ok: false, reason: 'mercadopago_inactivo', processed: 0, results: [] };
  }

  const [rows] = await pool.execute(
    `SELECT ts.id, ts.mp_customer_id, ts.mp_card_id, ts.mp_card_brand,
            ts.renovacion_intentos,
            s.nombre AS plan_nombre, s.precio, s.vigencia_dias,
            u.email,
            tp.identification_type, tp.identification_number
     FROM tribu_suscripciones ts
     JOIN suscripciones s ON s.id = ts.suscripcion_id
     JOIN tribu_users u ON u.id = ts.tribu_user_id
     LEFT JOIN tribu_payer_profiles tp ON tp.tribu_user_id = ts.tribu_user_id
     WHERE ts.auto_renovacion = 1
       AND ts.activo = 1
       AND ts.mp_customer_id IS NOT NULL
       AND ts.mp_card_id IS NOT NULL
       AND ts.fecha_fin <= CURDATE()
       AND ts.renovacion_intentos < 4
       AND (ts.next_renovacion_intento IS NULL OR ts.next_renovacion_intento <= NOW())
     ORDER BY ts.fecha_fin ASC
     LIMIT 20`
  );

  const results = [];
  for (const row of rows) {
    try {
      results.push(await procesarRenovacionSuscripcion(row, cfg));
    } catch (err) {
      await markRenewalFailed(row.id, err.message);
      results.push({ id: row.id, ok: false, error: err.message });
    }
  }

  return { ok: true, processed: results.length, results };
}

module.exports = {
  activateNewSubscription,
  extendSubscriptionRenewal,
  applyApprovedOrder,
  runRenovacionesSuscripciones,
  isOrderPaid,
};
