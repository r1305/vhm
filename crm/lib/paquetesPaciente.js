const pool = require('./db');
const { buildCuotasPlan, normalizeDiasSiguienteCuota } = require('./cuotasPlan');

const TZ = 'America/Lima';

function effectivePrecio(rowPrecio, catalogPrecio) {
  const p = Number(rowPrecio);
  if (p > 0) return p;
  return Number(catalogPrecio) || 0;
}

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

function errorValidacion(message) {
  return Object.assign(new Error(message), { status: 400, publico: true });
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

async function countCitasActivas(pacienteId, desdeDate = null, db = pool) {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) AS total FROM citas
     WHERE paciente_id = ? AND estado IN ('realizada','no_show')
     ${desdeDate ? 'AND DATE(fecha) >= ?' : ''}`,
    desdeDate ? [pacienteId, desdeDate] : [pacienteId]
  );
  return row?.total || 0;
}

async function countCitasActivasForPaquete(pacientePaqueteId, desdeDate = null, pacienteId = null, db = pool) {
  // Suma las citas vinculadas al paquete y, si se conoce al paciente, también las
  // citas legacy (sin paquete) dentro del rango. Coincide con SQL.sesionesPendientes
  // para que guard de compra, ciclo de vida y UI nunca diverjan.
  let sql, params;
  if (pacienteId != null) {
    sql = `SELECT COUNT(*) AS total FROM citas
           WHERE estado IN ('realizada','no_show')
             AND DATE(fecha) >= ?
             AND (paciente_paquete_id = ? OR (paciente_paquete_id IS NULL AND paciente_id = ?))`;
    params = [desdeDate || '1970-01-01', pacientePaqueteId, pacienteId];
  } else {
    sql = `SELECT COUNT(*) AS total FROM citas
           WHERE estado IN ('realizada','no_show') AND paciente_paquete_id = ?`;
    params = [pacientePaqueteId];
    if (desdeDate) { sql += ' AND DATE(fecha) >= ?'; params.push(desdeDate); }
  }
  const [[row]] = await db.execute(sql, params);
  return row?.total || 0;
}

const ESTADOS_RESERVADA_SQL = "'pendiente','confirmada','reagendada'";

function desdeReserva(desdeDate) {
  const hoy = todayStr();
  return desdeDate && desdeDate > hoy ? desdeDate : hoy;
}

async function countCitasReservadas(pacienteId, desdeDate = null, db = pool) {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) AS total FROM citas
     WHERE paciente_id = ? AND estado IN (${ESTADOS_RESERVADA_SQL})
       AND DATE(fecha) >= ?`,
    [pacienteId, desdeReserva(desdeDate)]
  );
  return Number(row?.total) || 0;
}

async function countCitasReservadasForPaquete(pacientePaqueteId, desdeDate = null, pacienteId = null, db = pool) {
  let sql = `SELECT COUNT(*) AS total FROM citas
             WHERE estado IN (${ESTADOS_RESERVADA_SQL}) AND DATE(fecha) >= ?`;
  const params = [desdeReserva(desdeDate)];
  if (pacienteId != null) {
    sql += ' AND (paciente_paquete_id = ? OR (paciente_paquete_id IS NULL AND paciente_id = ?))';
    params.push(pacientePaqueteId, pacienteId);
  } else {
    sql += ' AND paciente_paquete_id = ?';
    params.push(pacientePaqueteId);
  }
  const [[row]] = await db.execute(sql, params);
  return Number(row?.total) || 0;
}

function cupoReserva(total, usadas, reservadas) {
  const t = Number(total) || 0;
  const ocupadas = (Number(usadas) || 0) + (Number(reservadas) || 0);
  return {
    disponibles: Math.max(0, t - ocupadas),
    siguienteSesion: ocupadas + 1,
    sinCupo: ocupadas >= t,
  };
}

const MSG_SIN_SESIONES = 'No tienes sesiones disponibles para agendar. Contacta a tu terapeuta para adquirir más sesiones.';
const MSG_SIN_CUPO_RESERVADO = 'Ya tienes citas agendadas para todas tus sesiones disponibles. Contacta a tu terapeuta si necesitas más sesiones.';

function respuestaSinCupo(usadas, total) {
  return {
    ok: false,
    codigo: 'SIN_SESIONES',
    mensaje: (Number(usadas) || 0) >= (Number(total) || 0) ? MSG_SIN_SESIONES : MSG_SIN_CUPO_RESERVADO,
    sesiones_disponibles: 0,
  };
}

async function syncPackageLifecycle(pacienteId, db = pool) {
  const hoy = todayStr();
  const [packages] = await db.execute(
    `SELECT * FROM paciente_paquetes WHERE paciente_id = ? ORDER BY fecha_inicio ASC, id ASC`,
    [pacienteId]
  );

  for (const pkg of packages) {
    if (!pkg.activo) continue;
    const citas = await countCitasActivasForPaquete(pkg.id, dateStr(pkg.fecha_inicio), pkg.paciente_id, db);
    const exhausted = citas >= pkg.sesiones;
    const expired = isPackageExpired(pkg, hoy);
    if (expired || exhausted) {
      await db.execute('UPDATE paciente_paquetes SET activo = 0 WHERE id = ?', [pkg.id]);
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
      const citas = await countCitasActivasForPaquete(pkg.id, dateStr(pkg.fecha_inicio), pkg.paciente_id, db);
      if (citas >= pkg.sesiones) continue;
      await db.execute('UPDATE paciente_paquetes SET activo = 1 WHERE id = ?', [pkg.id]);
      pkg.activo = 1;
      break;
    }
  }
}

async function getActivePacientePaquete(pacienteId, db = pool) {
  await syncPackageLifecycle(pacienteId, db);
  const hoy = todayStr();
  const [[row]] = await db.execute(
    `SELECT * FROM paciente_paquetes
     WHERE paciente_id = ? AND activo = 1
     ORDER BY fecha_inicio ASC, id ASC
     LIMIT 1`,
    [pacienteId]
  );
  if (!row) return null;
  if (isPackageExpired(row, hoy) || isPackageNotStarted(row, hoy)) return null;
  const citas = await countCitasActivasForPaquete(row.id, dateStr(row.fecha_inicio), pacienteId, db);
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
    `SELECT pp.*, pc.precio AS catalogo_precio
     FROM paciente_paquetes pp
     LEFT JOIN paquetes_catalogo pc ON pc.id = pp.paquete_catalogo_id
     WHERE pp.paciente_id = ?
     ORDER BY pp.fecha_inicio DESC, pp.id DESC`,
    [pacienteId]
  );
  // Calcular sesiones_usadas para cada paquete en orden ASC (más antiguo primero)
  const rowsAsc = [...rows].sort((a, b) => {
    const da = dateStr(a.fecha_inicio), db = dateStr(b.fecha_inicio);
    return da < db ? -1 : da > db ? 1 : a.id - b.id;
  });
  const usadasMap = {};
  for (const row of rowsAsc) {
    usadasMap[row.id] = await countCitasActivasForPaquete(row.id, dateStr(row.fecha_inicio), pacienteId);
  }

  const result = [];
  for (const row of rows) {
    const cuotas = await loadCuotas(row.id);
    const sesionesUsadas = usadasMap[row.id];
    const activo = !!row.activo;
    const { catalogo_precio, ...pkgRow } = row;
    result.push({
      ...pkgRow,
      accede_comunidad: !!row.accede_comunidad,
      activo,
      precio: effectivePrecio(row.precio, catalogo_precio),
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
  if (!catalogoId) throw errorValidacion('Selecciona un paquete');

  const [[cat]] = await pool.execute(
    'SELECT * FROM paquetes_catalogo WHERE id = ? AND activo = 1',
    [catalogoId]
  );
  if (!cat) throw errorValidacion('Paquete no encontrado o inactivo');

  const tipoPago = payload.tipo_pago === 'parcial' ? 'parcial' : 'total';
  let numCuotas = tipoPago === 'parcial' ? parseInt(payload.num_cuotas, 10) : 1;
  if (!numCuotas || numCuotas < 1) numCuotas = 1;
  if (tipoPago === 'parcial' && numCuotas < 2) throw errorValidacion('El pago parcial requiere al menos 2 cuotas');
  if (numCuotas > cat.sesiones) throw errorValidacion('Las cuotas no pueden superar el número de sesiones');

  await syncPackageLifecycle(pacienteId);
  const activePkg = await getActivePacientePaquete(pacienteId);
  if (activePkg) {
    const citasUsadas = await countCitasActivasForPaquete(activePkg.id, dateStr(activePkg.fecha_inicio), activePkg.paciente_id);
    const restantes = activePkg.sesiones - citasUsadas;
    throw errorValidacion(
      `El paciente ya tiene el paquete "${activePkg.nombre}" activo con ${restantes} sesión${restantes !== 1 ? 'es' : ''} disponible${restantes !== 1 ? 's' : ''}. Debe agotar o vencer ese paquete antes de adquirir otro.`
    );
  }

  const fechaInicio = payload.fecha_inicio || todayStr();
  const nuevoActivo = 1;
  const diasSiguienteCuota = normalizeDiasSiguienteCuota(cat.dias_siguiente_cuota);

  const venceAt = addDays(fechaInicio, parseInt(cat.validez_dias, 10) || 30);
  const precio = Number(cat.precio) || 0;
  const sesiones = parseInt(cat.sesiones, 10) || 1;
  const descuento = Math.max(0, Number(payload.descuento) || 0);
  // Todo paquete asignado debe tener precio: es lo que alimenta el Reporte Financiero.
  if (precio <= 0) {
    throw errorValidacion(
      `El paquete "${cat.nombre}" no tiene precio en el catálogo. Asígnale un precio en Paquetes antes de venderlo.`
    );
  }
  if (descuento >= precio) {
    throw errorValidacion('El descuento no puede ser igual o mayor al precio del paquete');
  }
  const precioNeto = Math.round((precio - descuento) * 100) / 100;

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
          (paciente_paquete_id, numero, monto, fecha_pago, sesiones_inicio, sesiones_fin, pagado, pagado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pacientePaqueteId,
          cuota.numero,
          cuota.monto,
          cuota.fecha_pago,
          cuota.sesiones_inicio,
          cuota.sesiones_fin,
          cuota.pagado,
          null,
        ]
      );
    }
    await conn.execute(
      `UPDATE paciente_paquete_cuotas SET pagado_at = (
         SELECT created_at FROM paciente_paquetes WHERE id = ?
       ) WHERE paciente_paquete_id = ? AND pagado = 1 AND pagado_at IS NULL`,
      [pacientePaqueteId, pacientePaqueteId]
    );

    await conn.commit();
    return pacientePaqueteId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deletePacientePaquete(pacienteId, pkgId) {
  const [[pkg]] = await pool.execute(
    'SELECT id FROM paciente_paquetes WHERE id = ? AND paciente_id = ?',
    [pkgId, pacienteId]
  );
  if (!pkg) throw errorValidacion('Paquete no encontrado');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE citas SET paciente_paquete_id = NULL WHERE paciente_paquete_id = ?', [pkgId]);
    await conn.execute('DELETE FROM paciente_paquete_cuotas WHERE paciente_paquete_id = ?', [pkgId]);
    await conn.execute('DELETE FROM paciente_paquetes WHERE id = ?', [pkgId]);
    await conn.commit();
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
  if (!cuota) throw errorValidacion('Cuota no encontrada');
  if (cuota.pagado) return { ok: true, already: true };

  await pool.execute(
    'UPDATE paciente_paquete_cuotas SET pagado = 1, pagado_at = NOW() WHERE id = ?',
    [cuotaId]
  );
  return { ok: true };
}

async function syncCuotasForPaquete(pkgId) {
  const [[pkg]] = await pool.execute('SELECT * FROM paciente_paquetes WHERE id = ?', [pkgId]);
  if (!pkg) return;

  const plan = buildCuotasPlan({
    precio: Number(pkg.precio) || 0,
    sesiones: parseInt(pkg.sesiones, 10) || 1,
    diasSiguienteCuota: pkg.dias_siguiente_cuota,
    fechaInicio: dateStr(pkg.fecha_inicio),
    numCuotas: pkg.num_cuotas,
    tipoPago: pkg.tipo_pago,
  });

  const [existentes] = await pool.execute(
    'SELECT id, pagado FROM paciente_paquete_cuotas WHERE paciente_paquete_id = ? ORDER BY numero',
    [pkgId]
  );

  for (let i = 0; i < plan.length; i++) {
    const c = plan[i];
    if (existentes[i]) {
      await pool.execute(
        'UPDATE paciente_paquete_cuotas SET monto = ?, fecha_pago = ?, sesiones_inicio = ?, sesiones_fin = ? WHERE id = ?',
        [c.monto, c.fecha_pago, c.sesiones_inicio, c.sesiones_fin, existentes[i].id]
      );
    } else {
      await pool.execute(
        `INSERT INTO paciente_paquete_cuotas
          (paciente_paquete_id, numero, monto, fecha_pago, sesiones_inicio, sesiones_fin, pagado, pagado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [pkgId, c.numero, c.monto, c.fecha_pago, c.sesiones_inicio, c.sesiones_fin, c.pagado, null]
      );
    }
  }
  for (let i = plan.length; i < existentes.length; i++) {
    if (!existentes[i].pagado) {
      await pool.execute('DELETE FROM paciente_paquete_cuotas WHERE id = ?', [existentes[i].id]);
    }
  }
  await pool.execute(
    'UPDATE paciente_paquete_cuotas SET pagado_at = ? WHERE paciente_paquete_id = ? AND pagado = 1 AND pagado_at IS NULL',
    [pkg.created_at, pkgId]
  );
}

/**
 * Detecta paquetes de pacientes cuyo precio no llegaría bien al Reporte Financiero:
 *   - sin_precio:       paciente_paquetes.precio = 0 pero el catálogo sí tiene precio
 *   - sin_cuotas:       el paquete no tiene ninguna cuota (no suma a cobrado / por cobrar)
 *   - cuotas_descuadre: la suma de cuotas no coincide con el precio del paquete
 *   - catalogo_sin_precio: ni el paquete ni su catálogo tienen precio (requiere acción manual)
 */
async function findPaquetesPrecioInconsistentes() {
  const [rows] = await pool.execute(
    `SELECT * FROM (
       SELECT pp.id, pp.paciente_id, pp.nombre, pp.precio, pp.paquete_catalogo_id,
              pc.precio AS catalogo_precio,
              p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
              (SELECT COUNT(*) FROM paciente_paquete_cuotas c WHERE c.paciente_paquete_id = pp.id) AS n_cuotas,
              (SELECT COALESCE(SUM(c.monto),0) FROM paciente_paquete_cuotas c WHERE c.paciente_paquete_id = pp.id) AS suma_cuotas
       FROM paciente_paquetes pp
       LEFT JOIN paquetes_catalogo pc ON pc.id = pp.paquete_catalogo_id
       LEFT JOIN pacientes p ON p.id = pp.paciente_id
     ) x
     WHERE x.precio <= 0
        OR x.n_cuotas = 0
        OR ABS(x.suma_cuotas - x.precio) > 0.01
     ORDER BY x.id`
  );
  return rows.map((r) => {
    const precio = Number(r.precio) || 0;
    const catPrecio = Number(r.catalogo_precio) || 0;
    let problema;
    if (precio <= 0 && catPrecio <= 0) problema = 'catalogo_sin_precio';
    else if (precio <= 0) problema = 'sin_precio';
    else if (Number(r.n_cuotas) === 0) problema = 'sin_cuotas';
    else problema = 'cuotas_descuadre';
    return {
      ...r,
      precio,
      catalogo_precio: catPrecio,
      n_cuotas: Number(r.n_cuotas),
      suma_cuotas: Number(r.suma_cuotas),
      problema,
    };
  });
}

async function repairPaquetesPrecioInconsistente() {
  const rows = await findPaquetesPrecioInconsistentes();
  let reparados = 0;
  for (const row of rows) {
    if (row.problema === 'catalogo_sin_precio') {
      console.warn(
        `[crm] paciente_paquetes #${row.id} (${row.nombre}) de ${row.paciente_nombre || ''} ${row.paciente_apellido || ''} no tiene precio y su catálogo tampoco: asignar precio manualmente`
      );
      continue;
    }
    if (row.problema === 'sin_precio') {
      await pool.execute('UPDATE paciente_paquetes SET precio = ? WHERE id = ?', [row.catalogo_precio, row.id]);
    }
    await syncCuotasForPaquete(row.id);
    reparados += 1;
  }
  return reparados;
}

async function evaluateBooking(pacienteId, db = pool) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const paquete = await getActivePacientePaquete(pacienteId, db);
    if (!paquete) break;

    const desde = dateStr(paquete.fecha_inicio);
    const citasActivas = await countCitasActivasForPaquete(paquete.id, desde, pacienteId, db);

    if (citasActivas + 1 > paquete.sesiones) {
      await db.execute('UPDATE paciente_paquetes SET activo = 0 WHERE id = ?', [paquete.id]);
      await syncPackageLifecycle(pacienteId, db);
      continue;
    }

    const reservadas = await countCitasReservadasForPaquete(paquete.id, desde, pacienteId, db);
    const cupo = cupoReserva(paquete.sesiones, citasActivas, reservadas);
    if (cupo.sinCupo) return respuestaSinCupo(citasActivas, paquete.sesiones);

    const nextSessionNum = cupo.siguienteSesion;
    const [[cuota]] = await db.execute(
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
        sesiones_disponibles: cupo.disponibles,
      };
    }

    return {
      ok: true,
      sesiones_disponibles: cupo.disponibles,
      paciente_paquete_id: paquete.id,
    };
  }

  const citasActivas = await countCitasActivas(pacienteId, null, db);
  const [[legacy]] = await db.execute(
    `SELECT COALESCE((SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = ?), 0) AS total`,
    [pacienteId]
  );
  const totalLegacy = Number(legacy?.total) || 0;

  if (totalLegacy <= 0) {
    return {
      ok: false,
      codigo: 'SIN_PAQUETE',
      mensaje: 'No tienes un paquete activo. Contacta a tu terapeuta para adquirir sesiones.',
      sesiones_disponibles: 0,
    };
  }

  const reservadas = await countCitasReservadas(pacienteId, null, db);
  const cupo = cupoReserva(totalLegacy, citasActivas, reservadas);
  if (cupo.sinCupo) return respuestaSinCupo(citasActivas, totalLegacy);

  return { ok: true, sesiones_disponibles: cupo.disponibles, paciente_paquete_id: null };
}

/**
 * Resumen canónico de sesiones de un paciente.
 *
 * ÚNICA fuente de verdad: la consumen /pacientes/:pid/sesiones-resumen y la vista
 * de agenda, de modo que ambas muestran exactamente los mismos números.
 *
 * No depende del estado del paquete. Un paquete agotado, vencido o reemplazado
 * siguen apareciendo en el historial con sus cifras reales:
 *   - sesiones_registradas: total de sesiones adquiridas (histórico, todos los paquetes)
 *   - citas_tomadas:       sesiones consumidas (citas realizadas / no show)
 *   - pendientes:          sesiones agendables ahora (solo si hay paquete vigente)
 *
 * @returns {Promise<{sesiones_registradas:number, citas_tomadas:number, pendientes:number, paquete_activo:string|null}>}
 */
async function getSesionesResumen(pacienteId) {
  const paquetes = await loadPacientePaquetes(pacienteId);

  // Total adquirido: histórico completo. Si nunca tuvo paquetes, usa el legacy.
  const totalPaquetes = paquetes.reduce((acc, p) => acc + (Number(p.sesiones) || 0), 0);
  let sesionesRegistradas = totalPaquetes;

  if (!paquetes.length) {
    const [[legacy]] = await pool.execute(
      'SELECT COALESCE(SUM(sesiones), 0) AS total FROM paciente_sesiones WHERE paciente_id = ?',
      [pacienteId]
    );
    sesionesRegistradas = Number(legacy?.total) || 0;
  }

  // Sesiones consumidas: historial completo, sin importar el paquete.
  const citasTomadas = await countCitasActivas(pacienteId);

  // Agendables: únicamente las del paquete vigente.
  const vigente = paquetes.find((p) => p.estado === 'activo') || null;

  return {
    sesiones_registradas: sesionesRegistradas,
    citas_tomadas: citasTomadas,
    pendientes: vigente ? Number(vigente.sesiones_restantes) || 0 : 0,
    paquete_activo: vigente ? vigente.nombre : null,
  };
}

/**
 * Fragmentos SQL canónicos de sesiones.
 *
 * Se interpolan en queries que ya tienen el alias `p` = pacientes. Existen para
 * que el dashboard, el listado y el detalle usen EXACTAMENTE la misma definición
 * y los números nunca diverjan entre vistas.
 *
 *   - SQL.sesionesTotal(p)      total adquirido (histórico; legacy solo si no hay paquetes)
 *   - SQL.citasConfirmadas(p)   sesiones consumidas (citas realizadas / no show)
 *   - SQL.sesionesPendientes(p) sesiones agendables ahora (solo paquete vigente)
 *   - SQL.paqueteNombre(p)      nombre del paquete vigente, o NULL
 */
const SQL = {
  sesionesTotal: (p = 'p') => `COALESCE(
           (SELECT SUM(pp.sesiones) FROM paciente_paquetes pp WHERE pp.paciente_id = ${p}.id),
           (SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = ${p}.id),
           0
         )`,

  citasConfirmadas: (p = 'p') => `(
           SELECT COUNT(*) FROM citas c
           WHERE c.paciente_id = ${p}.id AND c.estado IN ('realizada','no_show')
         )`,

  // Un paquete cuenta como vigente solo si está activo, no venció y ya empezó.
  sesionesPendientes: (p = 'p') => `COALESCE(GREATEST(0, (
           SELECT pp.sesiones - (
             (SELECT COUNT(*) FROM citas c2
              WHERE c2.paciente_paquete_id = pp.id
                AND c2.estado IN ('realizada','no_show')
                AND DATE(c2.fecha) >= DATE(pp.fecha_inicio))
             + (SELECT COUNT(*) FROM citas c3
                WHERE c3.paciente_id = ${p}.id AND c3.paciente_paquete_id IS NULL
                  AND c3.estado IN ('realizada','no_show')
                  AND DATE(c3.fecha) >= DATE(pp.fecha_inicio))
           )
           FROM paciente_paquetes pp
           WHERE pp.paciente_id = ${p}.id AND pp.activo = 1
             AND (pp.vence_at IS NULL OR pp.vence_at >= CURDATE())
             AND DATE(pp.fecha_inicio) <= CURDATE()
           ORDER BY pp.fecha_inicio ASC, pp.id ASC LIMIT 1
         )), 0)`,

  paqueteNombre: (p = 'p') => `(
           SELECT pp.nombre FROM paciente_paquetes pp
           WHERE pp.paciente_id = ${p}.id AND pp.activo = 1
             AND (pp.vence_at IS NULL OR pp.vence_at >= CURDATE())
             AND DATE(pp.fecha_inicio) <= CURDATE()
           ORDER BY pp.fecha_inicio ASC, pp.id ASC LIMIT 1
         )`,

  // Nunca tuvo sesiones en ninguno de los dos sistemas.
  sinSesiones: (p = 'p') => `(
           NOT EXISTS (SELECT 1 FROM paciente_paquetes pp WHERE pp.paciente_id = ${p}.id)
           AND NOT EXISTS (SELECT 1 FROM paciente_sesiones ps WHERE ps.paciente_id = ${p}.id)
         )`,

  // Pacientes que compraron 2+ paquetes (o 2+ registros legacy si nunca usaron el
  // sistema de paquetes). Es la base de la tasa de retención.
  paquetesComprados: (p = 'p') => `GREATEST(
           (SELECT COUNT(*) FROM paciente_paquetes pp WHERE pp.paciente_id = ${p}.id),
           CASE WHEN EXISTS (SELECT 1 FROM paciente_paquetes pp WHERE pp.paciente_id = ${p}.id)
                THEN 0 ELSE (SELECT COUNT(*) FROM paciente_sesiones ps WHERE ps.paciente_id = ${p}.id) END
         )`,
};

module.exports = {
  effectivePrecio,
  findPaquetesPrecioInconsistentes,
  repairPaquetesPrecioInconsistente,
  addDays,
  addMonths,
  countCitasActivas,
  countCitasActivasForPaquete,
  countCitasReservadas,
  countCitasReservadasForPaquete,
  cupoReserva,
  syncPackageLifecycle,
  getActivePacientePaquete,
  loadCuotas,
  loadPacientePaquetes,
  createPacientePaquete,
  deletePacientePaquete,
  markCuotaPagada,
  syncCuotasForPaquete,
  evaluateBooking,
  getSesionesResumen,
  computePackageEstado,
  SQL,
};
