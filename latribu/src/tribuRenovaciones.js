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
  validateChargeForPlan,
} = require('./tribuCulqi');
const { recordCulqiTransaction } = require('./tribuCulqiTransactionLog');
const { MAX_INTENTOS_RENOVACION, graciaDias } = require('./lib/suscripcionAcceso');

const RENOVACION_LOCK_NAME = 'tribu_renovaciones';
const RENOVACION_CLAIM_MINUTES = 30;
const COBRO_RECIENTE_HORAS = 48;

function ymdLima(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function conTransaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

async function bloquearCargo(conn, chargeId, tribuSuscripcionId = 0) {
  try {
    await conn.execute(
      'INSERT INTO tribu_culqi_payment_events (culqi_charge_id, tribu_suscripcion_id) VALUES (?, ?)',
      [String(chargeId), tribuSuscripcionId || 0]
    );
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}

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
        AND pendiente_conciliar = 0
        AND (renovacion_intentos < ? OR renovacion_intentos IS NULL)
        AND (next_renovacion_intento IS NULL OR next_renovacion_intento <= NOW())
        AND (renovando = 0 OR renovando IS NULL)
      LIMIT 1`,
    [RENOVACION_CLAIM_MINUTES, RENOVACION_CLAIM_MINUTES, process.pid, subId, MAX_INTENTOS_RENOVACION]
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
  const dias = vigenciaDias || 30;
  const autoOn = autoRenovacion && cardId ? 1 : 0;

  return conTransaccion(async (conn) => {
    if (!(await bloquearCargo(conn, ref, 0))) {
      const [[sub]] = await conn.execute(
        'SELECT id FROM tribu_suscripciones WHERE culqi_charge_id = ? LIMIT 1', [ref]
      );
      if (sub) return sub.id;
      const [[ev]] = await conn.execute(
        'SELECT tribu_suscripcion_id FROM tribu_culqi_payment_events WHERE culqi_charge_id = ? LIMIT 1', [ref]
      );
      return ev?.tribu_suscripcion_id || null;
    }

    const [[vigente]] = await conn.execute(
      `SELECT MAX(fecha_fin) AS fin FROM tribu_suscripciones
        WHERE tribu_user_id = ? AND activo = 1 AND fecha_fin >= CURDATE() FOR UPDATE`,
      [userId]
    );
    const desde = ymdLima(vigente?.fin);

    await conn.execute(
      'UPDATE tribu_suscripciones SET auto_renovacion = 0 WHERE tribu_user_id = ? AND activo = 1 AND auto_renovacion = 1',
      [userId]
    );
    await conn.execute(
      'UPDATE tribu_suscripciones SET activo = 0 WHERE tribu_user_id = ? AND suscripcion_id = ? AND activo = 1',
      [userId, planId]
    );
    const [result] = await conn.execute(
      `INSERT INTO tribu_suscripciones
        (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin,
         culqi_charge_id, auto_renovacion, renovacion_intentos,
         culqi_customer_id, culqi_card_id, culqi_card_brand)
       VALUES (?, ?, 1, CURDATE(), DATE_ADD(GREATEST(CURDATE(), COALESCE(CAST(? AS DATE), CURDATE())), INTERVAL ? DAY), ?, ?, 0, ?, ?, ?)`,
      [
        userId,
        planId,
        desde,
        dias,
        ref,
        autoOn,
        customerId ? String(customerId) : null,
        cardId ? String(cardId) : null,
        cardBrand ? String(cardBrand).slice(0, 32) : null,
      ]
    );
    await conn.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [userId]);
    await conn.execute(
      'UPDATE tribu_culqi_payment_events SET tribu_suscripcion_id = ? WHERE culqi_charge_id = ?',
      [result.insertId, ref]
    );
    return result.insertId;
  });
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
  const dias = vigenciaDias || 30;
  return conTransaccion(async (conn) => {
    if (!(await bloquearCargo(conn, ref, tribuSubId))) return false;
    await conn.execute(
      `UPDATE tribu_suscripciones
       SET fecha_fin = DATE_ADD(GREATEST(fecha_fin, CURDATE()), INTERVAL ? DAY),
           activo = 1,
           culqi_charge_id = ?,
           renovacion_intentos = 0,
           next_renovacion_intento = NULL,
           pendiente_conciliar = 0
       WHERE id = ?`,
      [dias, ref, tribuSubId]
    );
    return true;
  });
}

async function markRenewalFailed(tribuSubId, errorMsg) {
  const [[row]] = await pool.execute(
    'SELECT renovacion_intentos FROM tribu_suscripciones WHERE id = ? LIMIT 1',
    [tribuSubId]
  );
  const intentos = row?.renovacion_intentos || 0;
  const disableAuto = intentos >= MAX_INTENTOS_RENOVACION;

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

async function markPendienteConciliar(tribuSubId, chargeId, motivo) {
  console.error(
    `[tribu-renovacion][CONCILIAR] sub=${tribuSubId} charge=${chargeId || '-'}: cobro aprobado sin aplicar (${motivo}). Revisar manualmente.`
  );
  try {
    await pool.execute(
      'UPDATE tribu_suscripciones SET pendiente_conciliar = 1, next_renovacion_intento = NULL WHERE id = ?',
      [tribuSubId]
    );
  } catch (err) {
    console.error(`[tribu-renovacion][CONCILIAR] no se pudo marcar sub=${tribuSubId}:`, err.message);
  }
}

async function marcarResultadoDesconocido(tribuSubId, motivo) {
  console.error(
    `[tribu-renovacion] resultado desconocido sub=${tribuSubId}: ${motivo}. Se reintentará con la misma clave de idempotencia.`
  );
  try {
    await pool.execute(
      `UPDATE tribu_suscripciones
          SET renovacion_intentos = GREATEST(renovacion_intentos - 1, 0),
              next_renovacion_intento = NOW() + INTERVAL 1 HOUR
        WHERE id = ?`,
      [tribuSubId]
    );
  } catch (err) {
    console.error(`[tribu-renovacion] no se pudo reprogramar sub=${tribuSubId}:`, err.message);
  }
}

async function cobroRenovacionReciente(tribuSubId) {
  const [[row]] = await pool.execute(
    `SELECT culqi_charge_id FROM tribu_culqi_transactions
      WHERE external_reference LIKE ? AND status = 'approved'
        AND created_at >= NOW() - INTERVAL ? HOUR
      ORDER BY created_at DESC LIMIT 1`,
    [`tribu-renew-${tribuSubId}-%`, COBRO_RECIENTE_HORAS]
  );
  return row?.culqi_charge_id || null;
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
      `SELECT ts.id, s.vigencia_dias, s.precio
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       WHERE ts.id = ? LIMIT 1`,
      [parsed.tribuSubId]
    );
    const check = validateChargeForPlan(charge, sub);
    if (!check.ok) return { tribuSuscripcionId: null, rejected: check.reason };
    await extendSubscriptionRenewal(sub.id, chargeId, sub.vigencia_dias);
    return { tribuSuscripcionId: sub.id };
  }

  const { userId, planId } = parsed;
  if (!userId || !planId) return { tribuSuscripcionId: null, rejected: 'referencia' };

  const [[plan]] = await pool.execute(
    'SELECT id, precio, vigencia_dias FROM suscripciones WHERE id = ?',
    [planId]
  );
  const check = validateChargeForPlan(charge, plan);
  if (!check.ok) return { tribuSuscripcionId: null, rejected: check.reason };

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

  const reciente = await cobroRenovacionReciente(row.id);
  if (reciente) {
    let aplicado = false;
    try {
      aplicado = await extendSubscriptionRenewal(row.id, reciente, row.vigencia_dias);
    } catch (err) {
      await markPendienteConciliar(row.id, reciente, err.message);
      return { id: row.id, ok: false, pendiente_conciliar: true, charge_id: reciente };
    }
    if (!aplicado) await markPendienteConciliar(row.id, reciente, 'cobro aprobado en las últimas 48 h ya registrado');
    return { id: row.id, ok: aplicado, skipped: 'cobro_reciente', charge_id: reciente };
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

  const intento = (Number(row.renovacion_intentos) || 0) + 1;
  let charge;
  try {
    charge = await createCulqiCharge(
      cfg.secret_key, chargeBody, buildRenewalIdempotencyKey(row.id, row.fecha_fin, intento)
    );
  } catch (err) {
    if (err.unknownOutcome) {
      await marcarResultadoDesconocido(row.id, err.message);
      return { id: row.id, ok: false, unknown: true, error: err.message };
    }
    throw err;
  }
  const outcome = resolveChargeOutcome(charge);

  await recordCulqiTransaction(charge, {
    source: 'cron_renovacion',
    tribuUserId: row.tribu_user_id,
    planId: row.suscripcion_id,
    tribuSuscripcionId: row.id,
    payerEmail: row.email,
  });

  if (outcome.status === 'approved') {
    try {
      await extendSubscriptionRenewal(row.id, outcome.charge_id, row.vigencia_dias);
    } catch (err) {
      await markPendienteConciliar(row.id, outcome.charge_id, err.message);
      return { id: row.id, ok: false, pendiente_conciliar: true, charge_id: outcome.charge_id };
    }
    return { id: row.id, ok: true, charge_id: outcome.charge_id };
  }

  await markRenewalFailed(row.id, outcome.status_detail || outcome.status);
  return { id: row.id, ok: false, status: outcome.status, detail: outcome.status_detail };
}

async function cerrarSuscripcionesVencidas() {
  try {
    const [result] = await pool.execute(
      `UPDATE tribu_suscripciones
          SET activo = 0
        WHERE activo = 1
          AND pendiente_conciliar = 0
          AND (renovando = 0 OR renovando IS NULL)
          AND fecha_fin < CURDATE()
          AND (auto_renovacion = 0
               OR culqi_card_id IS NULL
               OR renovacion_intentos >= ?
               OR fecha_fin < CURDATE() - INTERVAL ? DAY)`,
      [MAX_INTENTOS_RENOVACION, graciaDias()]
    );
    return result?.affectedRows || 0;
  } catch (err) {
    console.error('[tribu-renovacion] cerrar vencidas', err.message);
    return 0;
  }
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
              ts.renovacion_intentos, ts.fecha_fin,
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
         AND ts.pendiente_conciliar = 0
         AND ts.renovacion_intentos < ?
         AND (ts.next_renovacion_intento IS NULL OR ts.next_renovacion_intento <= NOW())
       ORDER BY ts.fecha_fin ASC
       LIMIT 20`,
      [MAX_INTENTOS_RENOVACION]
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

    const cerradas = await cerrarSuscripcionesVencidas();
    return { ok: true, processed: results.length, results, cerradas };
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
  procesarRenovacionSuscripcion,
  cerrarSuscripcionesVencidas,
  markPendienteConciliar,
  runRenovacionesSuscripciones,
  acquireRenovacionesLock,
  releaseRenovacionesLock,
  claimRenovacion,
  releaseRenovacionClaim,
  isChargePaid,
};
