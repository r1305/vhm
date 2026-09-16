const pool = require('./db');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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

function distributeSessions(total, numCuotas) {
  const blocks = [];
  let start = 1;
  const per = Math.floor(total / numCuotas);
  let extra = total % numCuotas;
  for (let i = 0; i < numCuotas; i++) {
    const count = per + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    blocks.push({ sesiones_inicio: start, sesiones_fin: start + count - 1 });
    start += count;
  }
  return blocks;
}

async function countCitasActivas(pacienteId) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM citas
     WHERE paciente_id = ? AND estado NOT IN ('cancelada','no_show')`,
    [pacienteId]
  );
  return row?.total || 0;
}

async function getActivePacientePaquete(pacienteId) {
  const [[row]] = await pool.execute(
    `SELECT * FROM paciente_paquetes
     WHERE paciente_id = ? AND activo = 1
     ORDER BY fecha_inicio DESC, id DESC
     LIMIT 1`,
    [pacienteId]
  );
  if (!row) return null;
  const hoy = todayStr();
  if (row.vence_at && String(row.vence_at).slice(0, 10) < hoy) return null;
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
  const [rows] = await pool.execute(
    `SELECT * FROM paciente_paquetes WHERE paciente_id = ? ORDER BY activo DESC, fecha_inicio DESC, id DESC`,
    [pacienteId]
  );
  const result = [];
  for (const row of rows) {
    const cuotas = await loadCuotas(row.id);
    result.push({
      ...row,
      accede_comunidad: !!row.accede_comunidad,
      activo: !!row.activo,
      precio: Number(row.precio),
      cuotas,
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

  const fechaInicio = payload.fecha_inicio || todayStr();
  const venceAt = addDays(fechaInicio, parseInt(cat.validez_dias, 10) || 30);
  const precio = Number(cat.precio) || 0;
  const sesiones = parseInt(cat.sesiones, 10) || 1;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'UPDATE paciente_paquetes SET activo = 0 WHERE paciente_id = ? AND activo = 1',
      [pacienteId]
    );

    const [ins] = await conn.execute(
      `INSERT INTO paciente_paquetes
        (paciente_id, paquete_catalogo_id, nombre, sesiones, validez_dias, accede_comunidad, precio,
         fecha_inicio, vence_at, tipo_pago, num_cuotas, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        pacienteId,
        catalogoId,
        cat.nombre,
        sesiones,
        cat.validez_dias,
        cat.accede_comunidad ? 1 : 0,
        precio,
        fechaInicio,
        venceAt,
        tipoPago,
        numCuotas,
      ]
    );

    const pacientePaqueteId = ins.insertId;
    const blocks = distributeSessions(sesiones, numCuotas);
    const montoBase = Math.floor((precio / numCuotas) * 100) / 100;
    let montoAsignado = 0;

    for (let i = 0; i < numCuotas; i++) {
      const monto = i === numCuotas - 1
        ? Math.round((precio - montoAsignado) * 100) / 100
        : montoBase;
      montoAsignado += monto;
      const block = blocks[i];
      await conn.execute(
        `INSERT INTO paciente_paquete_cuotas
          (paciente_paquete_id, numero, monto, fecha_pago, sesiones_inicio, sesiones_fin, pagado)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [
          pacientePaqueteId,
          i + 1,
          monto,
          addMonths(fechaInicio, i),
          block.sesiones_inicio,
          block.sesiones_fin,
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
  const citasActivas = await countCitasActivas(pacienteId);
  const nextSessionNum = citasActivas + 1;
  const paquete = await getActivePacientePaquete(pacienteId);

  if (paquete) {
    if (nextSessionNum > paquete.sesiones) {
      return {
        ok: false,
        codigo: 'SIN_SESIONES',
        mensaje: 'No tienes sesiones disponibles para agendar. Contacta a tu terapeuta para adquirir más sesiones.',
        sesiones_disponibles: 0,
      };
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
  const citasActivas = await countCitasActivas(pacienteId);
  if (paquete) {
    return {
      sesiones_total: paquete.sesiones,
      citas_confirmadas: citasActivas,
      paquete_nombre: paquete.nombre,
    };
  }
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
  distributeSessions,
  countCitasActivas,
  getActivePacientePaquete,
  loadCuotas,
  loadPacientePaquetes,
  createPacientePaquete,
  markCuotaPagada,
  evaluateBooking,
  getSesionesResumen,
};
