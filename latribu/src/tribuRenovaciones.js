/**
 * Suscripciones La Tribu: activación, renovación automática (Culqi + tarjeta guardada).
 */
const pool = require('./db');
const { newTrialChargeRef, trialDaysFromEnv } = require('../lib/tribuFunnel');
const {
  getCulqiConfig,
  buildRenewExternalRef,
  buildRenewalIdempotencyKey,
  buildChargeBody,
  createCulqiCharge,
  resolveChargeOutcome,
  isChargePaid,
  parseExternalRef,
} = require('./tribuCulqi');
const { recordCulqiTransaction } = require('./tribuCulqiTransactionLog');

const RENOVACION_LOCK_NAME = 'tribu_renovaciones';
const RENOVACION_CLAIM_MINUTES = 30;

async function acquireRenovacionesLock(connection, waitSeconds = 2) {
  try {
    const [[row]] = await connection.execute(
      'SELECT GET_LOCK(?, ?) AS obtenido',
      [RENOVACION_LOCK_NAME, Number(waitSeconds) || 0]
    );
    const obtenido = row ? Number(row.obtenido) : null;
    if (obtenido === 1) return true;
    if (obtenido === 0) return false;
    console.warn('[tribu-renovacion] GET_LOCK sin soporte, se continúa con el claim por suscripción');
    return true;
  } catch (err) {
    console.warn('[tribu-renovacion] GET_LOCK no disponible:', err.message);
    return true;
  }
}

async function releaseRenovacionesLock(connection) {
  if (!connection) return;
  try {
    await connection.execute('SELECT RELEASE_LOCK(?) AS liberado', [RENOVACION_LOCK_NAME]);
  } catch (err) {
    console.warn('[tribu-renovacion] RELEASE_LOCK no disponible:', err.message);
  }
}

async function claimRenovacion(subId) {
  const [result] = await pool.execute(
    `UPDATE tribu_suscripciones
        SET renovacion_intentos = renovacion_intentos + 1,
            next_renovacion_intento = NOW() + INTERVAL ? MINUTE,
            renovando = 1,
            renovando_hasta = NOW() + INTERVAL ? MINUTE,
            worker_pid = ?
      WHERE id = ?
        AND auto_renovacion = 1
        AND activo = 1
        AND fecha_fin <= CURDATE()
        AND culqi_customer_id IS NOT NULL
        AND culqi_card_id IS NOT NULL
        AND (renovacion_intentos < 4 OR renovacion_intentos IS NULL)
        AND (next_renovacion_intento IS NULL OR next_renovacion_intento <= NOW())
        AND (renovando = 0 OR renovando IS NULL)
      LIMIT 1`,
    [RENOVACION_CLAIM_MINUTES, RENOVACION_CLAIM_MINUTES, process.pid, subId]
  );
  return (result?.affectedRows || 0) >= 1;
}

async function releaseRenovacionClaim(subId) {
  try {
    await pool.execute(
      'UPDATE tribu_suscripciones SET renovando = 0, renovando_hasta = NULL, worker_pid = NULL WHERE id = ?',
      [subId]
    );
  } catch (err) {
    console.error('[tribu-renovacion] no se pudo liberar claim sub=' + subId, err.message);
  }
}

async function limpiarClaimsObsoletos() {
  try {
    const [result] = await pool.execute(
      `UPDATE tribu_suscripciones
          SET renovando = 0, renovando_hasta = NULL, worker_pid = NULL
        WHERE renovando = 1
          AND (renovando_hasta IS NULL OR renovando_hasta <= NOW())`
    );
    if ((result?.affectedRows || 0) > 0) {
      console.warn(`[tribu-renovacion] claims obsoletos liberados: ${result.affectedRows}`);
    }
  } catch (err) {
    console.error('[tribu-renovacion] limpiar claims obsoletos', err.message);
  }
}

async function paymentAlreadyProcessed(chargeId) {
  const [[row]] = await pool.execute(
    'SELECT culqi_charge_id FROM tribu_culqi_payment_events WHERE culqi_charge_id = ? LIMIT 1',
    [String(chargeId)]
  );
  return !!row;
}

async function recordPaymentEvent(chargeId, tribuSuscripcionId) {
  try {
    await pool.execute(
      'INSERT INTO tribu_culqi_payment_events (culqi_charge_id, tribu_suscripcion_id) VALUES (?, ?)',
      [String(chargeId), tribuSuscripcionId]
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
  chargeId,
  vigenciaDias,
  customerId = null,
  cardId = null,
  cardBrand = null,
  autoRenovacion = false,
}) {
  const ref = String(chargeId);
  const [[existing]] = await pool.execute(
    'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND culqi_charge_id = ? LIMIT 1',
    [userId, ref]
  );
  if (existing) return existing.id;

  const dias = vigenciaDias || 30;
  const autoOn = autoRenovacion && cardId ? 1 : 0;

  await pool.execute(
    'UPDATE tribu_suscripciones SET activo = 0, auto_renovacion = 0 WHERE tribu_user_id = ? AND suscripcion_id = ?',
    [userId, planId]
  );
  const [result] = await pool.execute(
    `INSERT INTO tribu_suscripciones
      (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin,
       culqi_charge_id, auto_renovacion, renovacion_intentos,
       culqi_customer_id, culqi_card_id, culqi_card_brand)
     VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, 0, ?, ?, ?)`,
    [
      userId,
      planId,
      dias,
      ref,
      autoOn,
      customerId ? String(customerId) : null,
      cardId ? String(cardId) : null,
      cardBrand ? String(cardBrand).slice(0, 32) : null,
    ]
  );
  await pool.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [userId]);
  await recordPaymentEvent(ref, result.insertId);
  return result.insertId;
}

/** Prueba gratuita: guarda tarjeta, sin cobro hoy; renovación al vencer fecha_fin. */
async function activateTrialSubscription({
  userId,
  planId,
  trialDays = trialDaysFromEnv(),
  customerId = null,
  cardId = null,
  cardBrand = null,
}) {
  if (!cardId) throw new Error('Tarjeta requerida para la prueba');
  const chargeId = newTrialChargeRef();
  const dias = trialDays || trialDaysFromEnv();
  const autoOn = customerId && cardId ? 1 : 0;

  await pool.execute(
    'UPDATE tribu_suscripciones SET activo = 0, auto_renovacion = 0 WHERE tribu_user_id = ? AND suscripcion_id = ?',
    [userId, planId]
  );
  const [result] = await pool.execute(
    `INSERT INTO tribu_suscripciones
      (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin,
       culqi_charge_id, auto_renovacion, es_prueba, renovacion_intentos,
       culqi_customer_id, culqi_card_id, culqi_card_brand)
     VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, 1, 0, ?, ?, ?)`,
    [
      userId,
      planId,
      dias,
      chargeId,
      autoOn,
      customerId ? String(customerId) : null,
      cardId ? String(cardId) : null,
      cardBrand ? String(cardBrand).slice(0, 32) : null,
    ]
  );
  await pool.execute('UPDATE tribu_users SET is_suscribed = 1, estado = ? WHERE id = ?', ['activo', userId]);
  await recordPaymentEvent(chargeId, result.insertId);
  return { tribuSuscripcionId: result.insertId, chargeId, trialDays: dias };
}

async function extendSubscriptionRenewal(tribuSubId, chargeId, vigenciaDias) {
  const ref = String(chargeId);
  if (await paymentAlreadyProcessed(ref)) return false;

  const dias = vigenciaDias || 30;
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET fecha_fin = DATE_ADD(GREATEST(fecha_fin, CURDATE()), INTERVAL ? DAY),
         activo = 1,
         culqi_charge_id = ?,
         renovacion_intentos = 0,
         next_renovacion_intento = NULL
     WHERE id = ?`,
    [dias, ref, tribuSubId]
  );
  await recordPaymentEvent(ref, tribuSubId);
  return true;
}

async function markRenewalFailed(tribuSubId, errorMsg) {
  const [[row]] = await pool.execute(
    'SELECT renovacion_intentos FROM tribu_suscripciones WHERE id = ? LIMIT 1',
    [tribuSubId]
  );
  const intentos = row?.renovacion_intentos || 0;
  const disableAuto = intentos >= 4;

  await pool.execute(
    `UPDATE tribu_suscripciones
     SET next_renovacion_intento = DATE_ADD(NOW(), INTERVAL 1 DAY),
         auto_renovacion = IF(?, 0, auto_renovacion),
         cancelada_at = IF(?, NOW(), cancelada_at)
     WHERE id = ?`,
    [disableAuto, disableAuto, tribuSubId]
  );
  console.error(`[tribu-renovacion] fallo sub=${tribuSubId}: ${errorMsg}`);
}

async function applyApprovedCharge(charge) {
  const outcome = resolveChargeOutcome(charge);
  if (outcome.status !== 'approved') return null;
  const chargeId = outcome.charge_id;
  if (!chargeId || await paymentAlreadyProcessed(chargeId)) return { tribuSuscripcionId: null, skipped: true };

  const externalRef = charge?.metadata?.external_reference;
  const parsed = parseExternalRef(externalRef);

  if (parsed.type === 'renew' && parsed.tribuSubId) {
    const [[sub]] = await pool.execute(
      `SELECT ts.id, s.vigencia_dias
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       WHERE ts.id = ? LIMIT 1`,
      [parsed.tribuSubId]
    );
    if (sub) {
      await extendSubscriptionRenewal(sub.id, chargeId, sub.vigencia_dias);
      return { tribuSuscripcionId: sub.id };
    }
    return null;
  }

  const { userId, planId } = parsed;
  if (!userId || !planId) return null;

  const [[plan]] = await pool.execute(
    'SELECT vigencia_dias FROM suscripciones WHERE id = ?',
    [planId]
  );
  if (!plan) return null;

  const [[existingSub]] = await pool.execute(
    'SELECT id FROM tribu_suscripciones WHERE tribu_user_id = ? AND culqi_charge_id = ? LIMIT 1',
    [userId, String(chargeId)]
  );
  if (existingSub) {
    await recordPaymentEvent(chargeId, existingSub.id);
    return { tribuSuscripcionId: existingSub.id };
  }

  const tribuSuscripcionId = await activateNewSubscription({
    userId,
    planId,
    chargeId,
    vigenciaDias: plan.vigencia_dias,
  });
  return { tribuSuscripcionId };
}

async function procesarRenovacionSuscripcion(row, cfg) {
  if (!row.culqi_customer_id || !row.culqi_card_id) {
    throw new Error('Sin tarjeta guardada para renovación');
  }

  const externalRef = buildRenewExternalRef(row.id);
  const identification = row.identification_type && row.identification_number
    ? { type: row.identification_type, number: row.identification_number }
    : null;

  const chargeBody = buildChargeBody({
    plan: { nombre: row.plan_nombre, precio: row.precio },
    email: row.email,
    user: {
      nombre: row.nombre,
      apellido: row.apellido,
      telefono: row.telefono,
    },
    identification,
    externalRef,
    sourceId: row.culqi_card_id,
    description: `Renovación ${row.plan_nombre}`,
  });

  const charge = await createCulqiCharge(cfg.secret_key, chargeBody, buildRenewalIdempotencyKey(row.id));
  const outcome = resolveChargeOutcome(charge);

  await recordCulqiTransaction(charge, {
    source: 'cron_renovacion',
    tribuUserId: row.tribu_user_id,
    planId: row.suscripcion_id,
    tribuSuscripcionId: row.id,
    payerEmail: row.email,
  });

  if (outcome.status === 'approved') {
    await extendSubscriptionRenewal(row.id, outcome.charge_id, row.vigencia_dias);
    return { id: row.id, ok: true, charge_id: outcome.charge_id };
  }

  await markRenewalFailed(row.id, outcome.status_detail || outcome.status);
  return { id: row.id, ok: false, status: outcome.status, detail: outcome.status_detail };
}

async function runRenovacionesSuscripciones(options = {}) {
  const lockConnection = options.lockConnection || null;
  let connection = lockConnection;
  let connectionPropia = false;
  let lockAdquirido = false;

  try {
    if (!connection) {
      connection = await pool.getConnection();
      connectionPropia = true;
      lockAdquirido = await acquireRenovacionesLock(connection, 2);
      if (!lockAdquirido) {
        return { ok: false, reason: 'ya_en_ejecucion', processed: 0, results: [] };
      }
    } else {
      lockAdquirido = true;
    }

    let cfg;
    try {
      cfg = await getCulqiConfig();
    } catch {
      return { ok: false, reason: 'culqi_inactivo', processed: 0, results: [] };
    }

    await limpiarClaimsObsoletos();

    const [rows] = await pool.execute(
      `SELECT ts.id, ts.tribu_user_id, ts.suscripcion_id,
              ts.culqi_customer_id, ts.culqi_card_id, ts.culqi_card_brand,
              ts.renovacion_intentos,
              s.nombre AS plan_nombre, s.precio, s.vigencia_dias,
              u.email, u.nombre, u.apellido, u.telefono,
              tp.identification_type, tp.identification_number
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       JOIN tribu_users u ON u.id = ts.tribu_user_id
       LEFT JOIN tribu_payer_profiles tp ON tp.tribu_user_id = ts.tribu_user_id
       WHERE ts.auto_renovacion = 1
         AND ts.activo = 1
         AND ts.culqi_customer_id IS NOT NULL
         AND ts.culqi_card_id IS NOT NULL
         AND ts.fecha_fin <= CURDATE()
         AND ts.renovacion_intentos < 4
         AND (ts.next_renovacion_intento IS NULL OR ts.next_renovacion_intento <= NOW())
       ORDER BY ts.fecha_fin ASC
       LIMIT 20`
    );

    const results = [];
    for (const row of rows) {
      if (!(await claimRenovacion(row.id))) continue;
      try {
        results.push(await procesarRenovacionSuscripcion(row, cfg));
      } catch (err) {
        await markRenewalFailed(row.id, err.message);
        results.push({ id: row.id, ok: false, error: err.message });
      } finally {
        await releaseRenovacionClaim(row.id);
      }
    }

    return { ok: true, processed: results.length, results };
  } finally {
    if (connectionPropia) {
      if (lockAdquirido) await releaseRenovacionesLock(connection);
      try { connection.release(); } catch (_) {}
    }
  }
}

module.exports = {
  activateNewSubscription,
  activateTrialSubscription,
  extendSubscriptionRenewal,
  applyApprovedCharge,
  runRenovacionesSuscripciones,
  acquireRenovacionesLock,
  releaseRenovacionesLock,
  claimRenovacion,
  releaseRenovacionClaim,
  isChargePaid,
};
