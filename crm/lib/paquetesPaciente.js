const pool = require('./db');
const { buildCuotasPlan, normalizeDiasSiguienteCuota } = require('./cuotasPlan');

const TZ = 'America/Lima';

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function dateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  }
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isPackageExpired(paquete, hoy) {
  return paquete.vence_at && dateStr(paquete.vence_at) < hoy;
}

function isPackageNotStarted(paquete, hoy) {
  return dateStr(paquete.fecha_inicio) > hoy;
}

function computePackageEstado(paquete, hoy, citasUsadas) {
  const exhausted = citasUsadas >= paquete.sesiones;
  const expired = isPackageExpired(paquete, hoy);
  const notStarted = isPackageNotStarted(paquete, hoy);

  if (paquete.activo && !expired && !notStarted && !exhausted) return 'activo';
  if (notStarted && !expired) return 'pendiente';
  if (expired) return 'vencido';
  if (exhausted) return 'agotado';
  if (!paquete.activo && !notStarted && !expired && !exhausted) return 'reemplazado';
  return 'inactivo';
}

async function countCitasActivas(pacienteId) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM citas
     WHERE paciente_id = ? AND estado NOT IN ('cancelada','no_show')`,
    [pacienteId]
  );
  return row?.total || 0;
}

async function countCitasActivasForPaquete(pacientePaqueteId) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM citas
     WHERE paciente_paquete_id = ? AND estado NOT IN ('cancelada','no_show')`,
    [pacientePaqueteId]
  );
  return row?.total || 0;
}

async function syncPackageLifecycle(pacienteId) {
  const hoy = todayStr();
  const [packages] = await pool.execute(
    `SELECT * FROM paciente_paquetes WHERE paciente_id = ? ORDER BY fecha_inicio ASC, id ASC`,
    [pacienteId]
  );

  for (const pkg of packages) {
    if (!pkg.activo) continue;
    const citas = await countCitasActivasForPaquete(pkg.id);
    const exhausted = citas >= pkg.sesiones;
    const expired = isPackageExpired(pkg, hoy);
    if (expired || exhausted) {
      await pool.execute('UPDATE paciente_paquetes SET activo = 0 WHERE id = ?', [pkg.id]);
      pkg.activo = 0;
    }
  }

  const hasActive = packages.some((p) => {
    if (!p.activo) return false;
    if (isPackageExpired(p, hoy) || isPackageNotStarted(p, hoy)) return false;
    return true;
  });

  if (!hasActive) {
    for (const pkg of packages) {
      if (pkg.activo) continue;
      if (isPackageNotStarted(pkg, hoy)) continue;
      if (isPackageExpired(pkg, hoy)) continue;
      const citas = await countCitasActivasForPaquete(pkg.id);
      if (citas >= pkg.sesiones) continue;
      await pool.execute('UPDATE paciente_paquetes SET activo = 1 WHERE id = ?', [pkg.id]);
      pkg.activo = 1;
      break;
    }
  }
}

async function getActivePacientePaquete(pacienteId) {
  await syncPackageLifecycle(pacienteId);
  const hoy = todayStr();
  const [[row]] = await pool.execute(
    `SELECT * FROM paciente_paquetes
     WHERE paciente_id = ? AND activo = 1
     ORDER BY fecha_inicio ASC, id ASC
     LIMIT 1`,
    [pacienteId]
  );
  if (!row) return null;
  if (isPackageExpired(row, hoy) || isPackageNotStarted(row, hoy)) return null;
  const citas = await countCitasActivasForPaquete(row.id);
  if (citas >= row.sesiones) return null;
  return row;
}

async function loadCuotas(pacientePaqueteId) {
  const [rows] = await pool.execute(
    `SELECT id, numero, monto, fecha_pago, sesiones_inicio, sesiones_fin, pagado, pagado_at
     FROM paciente_paquete_cuotas
     WHERE paciente_paquete_id = ?
     ORDER BY numero ASC`,
    [pacientePaqueteId]
  );
  return rows.map((r) => ({
    ...r,
    pagado: !!r.pagado,
    monto: Number(r.monto),
  }));
}

async function loadPacientePaquetes(pacienteId) {
  await syncPackageLifecycle(pacienteId);
  const hoy = todayStr();
  const [rows] = await pool.execute(
    `SELECT * FROM paciente_paquetes WHERE paciente_id = ? ORDER BY fecha_inicio DESC, id DESC`,
    [pacienteId]
  );
  // Citas generales del paciente (legacy, sin paciente_paquete_id)
  const [[legacyRow]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM citas
     WHERE paciente_id = ? AND paciente_paquete_id IS NULL AND estado NOT IN ('cancelada','no_show')`,
    [pacienteId]
  );
  const citasLegacy = Number(legacyRow?.total) || 0;
  let citasLegacyAsignadas = 0;

  const result = [];
  for (const row of rows) {
    const cuotas = await loadCuotas(row.id);
    let sesionesUsadas = await countCitasActivasForPaquete(row.id);
    // Fallback legacy: si el paquete no tiene citas vinculadas, usar citas generales
    if (sesionesUsadas === 0 && citasLegacy > 0) {
      const disponiblesLegacy = Math.max(0, citasLegacy - citasLegacyAsignadas);
      sesionesUsadas = Math.min(row.sesiones, disponiblesLegacy);
      citasLegacyAsignadas += sesionesUsadas;
    }
    const activo = !!row.activo;
    result.push({
      ...row,
      accede_comunidad: !!row.accede_comunidad,
      activo,
      precio: Number(row.precio),
      cuotas,
      sesiones_usadas: sesionesUsadas,
      sesiones_restantes: Math.max(0, row.sesiones - sesionesUsadas),
      estado: computePackageEstado({ ...row, activo }, hoy, sesionesUsadas),
    });
  }
  return result;
}

async function createPacientePaquete(pacienteId, payload) {
  const catalogoId = parseInt(payload.paquete_catalogo_id, 10);
  if (!catalogoId) throw new Error('Selecciona un paquete');

  const [[cat]] = await pool.execute(
    'SELECT * FROM paquetes_catalogo WHERE id = ? AND activo = 1',
    [catalogoId]
  );
  if (!cat) throw new Error('Paquete no encontrado o inactivo');

  const tipoPago = payload.tipo_pago === 'parcial' ? 'parcial' : 'total';
  let numCuotas = tipoPago === 'parcial' ? parseInt(payload.num_cuotas, 10) : 1;
  if (!numCuotas || numCuotas < 1) numCuotas = 1;
  if (tipoPago === 'parcial' && numCuotas < 2) throw new Error('El pago parcial requiere al menos 2 cuotas');
  if (numCuotas > cat.sesiones) throw new Error('Las cuotas no pueden superar el número de sesiones');

  await syncPackageLifecycle(pacienteId);
  const activePkg = await getActivePacientePaquete(pacienteId);
  if (activePkg) {
    const citasUsadas = await countCitasActivasForPaquete(activePkg.id);
    const restantes = activePkg.sesiones - citasUsadas;
    throw new Error(
      `El paciente ya tiene el paquete "${activePkg.nombre}" activo con ${restantes} sesión${restantes !== 1 ? 'es' : ''} disponible${restantes !== 1 ? 's' : ''}. Debe agotar o vencer ese paquete antes de adquirir otro.`
    );
  }

  const fechaInicio = payload.fecha_inicio || todayStr();
  const nuevoActivo = 1;

  const venceAt = addDays(fechaInicio, parseInt(cat.validez_dias, 10) || 30);
  const precio = Number(cat.precio) || 0;
  const sesiones = parseInt(cat.sesiones, 10) || 1;
  const descuento = Math.max(0, Number(payload.descuento) || 0);
  const precioNeto = Math.max(0, precio - descuento);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [ins] = await conn.execute(
      `INSERT INTO paciente_paquetes
        (paciente_id, paquete_catalogo_id, nombre, sesiones, validez_dias, dias_siguiente_cuota,
         accede_comunidad, precio, fecha_inicio, vence_at, tipo_pago, num_cuotas, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pacienteId,
        catalogoId,
        cat.nombre,
        sesiones,
        cat.validez_dias,
        diasSiguienteCuota,
        cat.accede_comunidad ? 1 : 0,
        precioNeto,
        fechaInicio,
        venceAt,
        tipoPago,
        numCuotas,
        nuevoActivo,
      ]
    );

    const pacientePaqueteId = ins.insertId;
    const cuotasPlan = buildCuotasPlan({
      precio: precioNeto,
      sesiones,
      diasSiguienteCuota,
      fechaInicio,
      numCuotas,
      tipoPago,
    });

    for (const cuota of cuotasPlan) {
      await conn.execute(
        `INSERT INTO paciente_paquete_cuotas
          (paciente_paquete_id, numero, monto, fecha_pago, sesiones_inicio, sesiones_fin, pagado)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          pacientePaqueteId,
          cuota.numero,
          cuota.monto,
          cuota.fecha_pago,
          cuota.sesiones_inicio,
          cuota.sesiones_fin,
          cuota.pagado,
        ]
      );
    }

    await conn.commit();
    return pacientePaqueteId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function markCuotaPagada(pacienteId, cuotaId) {
  const [[cuota]] = await pool.execute(
    `SELECT c.id, c.paciente_paquete_id, c.pagado
     FROM paciente_paquete_cuotas c
     INNER JOIN paciente_paquetes p ON p.id = c.paciente_paquete_id
     WHERE c.id = ? AND p.paciente_id = ?`,
    [cuotaId, pacienteId]
  );
  if (!cuota) throw new Error('Cuota no encontrada');
  if (cuota.pagado) return { ok: true, already: true };

  await pool.execute(
    'UPDATE paciente_paquete_cuotas SET pagado = 1, pagado_at = NOW() WHERE id = ?',
    [cuotaId]
  );
  return { ok: true };
}

async function evaluateBooking(pacienteId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const paquete = await getActivePacientePaquete(pacienteId);
    if (!paquete) break;

    const citasActivas = await countCitasActivasForPaquete(paquete.id);
    const nextSessionNum = citasActivas + 1;

    if (nextSessionNum > paquete.sesiones) {
      await pool.execute('UPDATE paciente_paquetes SET activo = 0 WHERE id = ?', [paquete.id]);
      await syncPackageLifecycle(pacienteId);
      continue;
    }

    const [[cuota]] = await pool.execute(
      `SELECT numero, pagado, fecha_pago FROM paciente_paquete_cuotas
       WHERE paciente_paquete_id = ? AND sesiones_inicio <= ? AND sesiones_fin >= ?`,
      [paquete.id, nextSessionNum, nextSessionNum]
    );

    if (!cuota || !cuota.pagado) {
      return {
        ok: false,
        codigo: 'CUOTA_PENDIENTE',
        mensaje: `Debes completar el pago de la cuota ${cuota?.numero || ''} antes de agendar esta sesión. Contacta a tu terapeuta.`,
        cuota_numero: cuota?.numero || null,
        sesiones_disponibles: Math.max(0, paquete.sesiones - citasActivas),
      };
    }

    return {
      ok: true,
      sesiones_disponibles: paquete.sesiones - citasActivas,
      paciente_paquete_id: paquete.id,
    };
  }

  const citasActivas = await countCitasActivas(pacienteId);
  const [[legacy]] = await pool.execute(
    `SELECT COALESCE((SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = ?), 0) AS total`,
    [pacienteId]
  );
  const totalLegacy = legacy?.total || 0;
  const disponibles = totalLegacy - citasActivas;

  if (totalLegacy <= 0) {
    return {
      ok: false,
      codigo: 'SIN_PAQUETE',
      mensaje: 'No tienes un paquete activo. Contacta a tu terapeuta para adquirir sesiones.',
      sesiones_disponibles: 0,
    };
  }

  if (disponibles <= 0) {
    return {
      ok: false,
      codigo: 'SIN_SESIONES',
      mensaje: 'No tienes sesiones disponibles para agendar. Contacta a tu terapeuta para adquirir más sesiones.',
      sesiones_disponibles: 0,
    };
  }

  return { ok: true, sesiones_disponibles: disponibles, paciente_paquete_id: null };
}

async function getSesionesResumen(pacienteId) {
  const paquete = await getActivePacientePaquete(pacienteId);
  if (paquete) {
    const citasActivas = await countCitasActivasForPaquete(paquete.id);
    return {
      sesiones_total: paquete.sesiones,
      citas_confirmadas: citasActivas,
      paquete_nombre: paquete.nombre,
    };
  }
  const citasActivas = await countCitasActivas(pacienteId);
  const [[legacy]] = await pool.execute(
    `SELECT COALESCE((SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = ?), 0) AS total`,
    [pacienteId]
  );
  return {
    sesiones_total: legacy?.total || 0,
    citas_confirmadas: citasActivas,
    paquete_nombre: null,
  };
}

module.exports = {
  addDays,
  addMonths,
  countCitasActivas,
  countCitasActivasForPaquete,
  syncPackageLifecycle,
  getActivePacientePaquete,
  loadCuotas,
  loadPacientePaquetes,
  createPacientePaquete,
  markCuotaPagada,
  evaluateBooking,
  getSesionesResumen,
  computePackageEstado,
};
