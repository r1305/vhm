const { Router } = require('express');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');
const { sendRecordatorioCita, sendFollowUp } = require('../lib/mailer');

const router = Router();

// ── Helper: validar y sanitizar rango de fechas ───────────────
function parseDateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(query.desde) ? query.desde : today;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(query.hasta) ? query.hasta : today;
  return { desde, hasta };
}

// ── Reportes con filtro de fecha ──────────────────────────────
router.get('/stats', auth, async (req, res) => {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const hastaFin = `${hasta} 23:59:59`;

    const tid = req.query.terapeuta_id ? parseInt(req.query.terapeuta_id, 10) : null;
    const tidFilter  = tid ? ` AND terapeuta_id = ${tid}`   : '';
    const tidFilterC = tid ? ` AND c.terapeuta_id = ${tid}` : '';

    const [[kpis]] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM citas
          WHERE fecha BETWEEN ? AND ? AND estado NOT IN ('cancelada','no_show')${tidFilter}) AS citas_periodo,
        (SELECT COUNT(*) FROM citas
          WHERE fecha BETWEEN ? AND ? AND estado='realizada'${tidFilter}) AS citas_realizadas,
        (SELECT COUNT(*) FROM citas
          WHERE fecha BETWEEN ? AND ? AND estado='cancelada'${tidFilter}) AS citas_canceladas,
        (SELECT COUNT(*) FROM citas
          WHERE fecha BETWEEN ? AND ? AND estado='no_show'${tidFilter}) AS no_shows,
        (SELECT COALESCE(SUM(monto),0) FROM pagos
          WHERE DATE(created_at) BETWEEN ? AND ? AND estado='completado') AS ingresos,
        (SELECT COUNT(*) FROM pacientes
          WHERE DATE(created_at) BETWEEN ? AND ?) AS pacientes_nuevos,
        (SELECT COUNT(*) FROM pacientes WHERE estado='activo') AS pacientes_activos,
        (SELECT COUNT(*) FROM pacientes WHERE estado='prospecto') AS prospectos
    `, [
      desde, hasta, desde, hasta, desde, hasta, desde, hasta,
      desde, hasta, desde, hasta
    ]);

    const [citasPorEstado] = await pool.execute(`
      SELECT estado, COUNT(*) AS total
      FROM citas WHERE fecha BETWEEN ? AND ?${tidFilter}
      GROUP BY estado ORDER BY total DESC
    `, [desde, hasta]);

    const [citasPorTerapeuta] = await pool.execute(`
      SELECT t.nombre, t.apellido, COUNT(c.id) AS total,
             SUM(CASE WHEN c.estado='realizada' THEN 1 ELSE 0 END) AS realizadas
      FROM citas c JOIN terapeutas t ON c.terapeuta_id=t.id
      WHERE c.fecha BETWEEN ? AND ?${tidFilterC}
      GROUP BY t.id ORDER BY total DESC
    `, [desde, hasta]);

    const [citasPorDia] = await pool.execute(`
      SELECT fecha, COUNT(*) AS total
      FROM citas WHERE fecha BETWEEN ? AND ?${tidFilter}
      GROUP BY fecha ORDER BY fecha ASC
    `, [desde, hasta]);

    // Ingresos por día
    const [ingresosPorDia] = await pool.execute(`
      SELECT DATE(created_at) AS dia, COALESCE(SUM(monto),0) AS total
      FROM pagos WHERE DATE(created_at) BETWEEN ? AND ? AND estado='completado'
      GROUP BY DATE(created_at) ORDER BY dia ASC
    `, [desde, hasta]);

    // Ingresos por método de pago
    const [ingresosPorMetodo] = await pool.execute(`
      SELECT metodo, COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total
      FROM pagos WHERE DATE(created_at) BETWEEN ? AND ? AND estado='completado'
      GROUP BY metodo ORDER BY total DESC
    `, [desde, hasta]);

    // Modalidad de citas
    const [citasPorModalidad] = await pool.execute(`
      SELECT modalidad, COUNT(*) AS total
      FROM citas WHERE fecha BETWEEN ? AND ?${tidFilter}
      GROUP BY modalidad ORDER BY total DESC
    `, [desde, hasta]);

    // Tasa de no-show
    const totalCitas = (kpis.citas_realizadas || 0) + (kpis.no_shows || 0);
    kpis.tasa_asistencia = totalCitas > 0
      ? Math.round((kpis.citas_realizadas / totalCitas) * 100)
      : null;
    kpis.ingreso_promedio_cita = kpis.citas_realizadas > 0
      ? Math.round((kpis.ingresos / kpis.citas_realizadas) * 100) / 100
      : 0;

    res.json({
      desde, hasta, kpis,
      citasPorEstado, citasPorTerapeuta, citasPorDia,
      ingresosPorDia, ingresosPorMetodo, citasPorModalidad,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dashboard KPIs (mantener para compatibilidad)
router.get('/dashboard', auth, async (req, res) => {
  try {
    const [[kpis]] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM pacientes WHERE estado='activo') AS pacientes_activos,
        (SELECT COUNT(*) FROM pacientes WHERE estado='prospecto') AS prospectos,
        (SELECT COUNT(*) FROM citas WHERE fecha=CURDATE() AND estado NOT IN ('cancelada','no_show')) AS citas_hoy,
        (SELECT COUNT(*) FROM citas WHERE fecha>=CURDATE() AND fecha<=DATE_ADD(CURDATE(),INTERVAL 7 DAY) AND estado='pendiente') AS citas_semana,
        (SELECT COALESCE(SUM(monto),0) FROM pagos WHERE MONTH(created_at)=MONTH(NOW()) AND estado='completado') AS ingresos_mes
    `);
    const [citasHoy] = await pool.execute(`
      SELECT c.*, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
             t.nombre AS terapeuta_nombre
      FROM citas c JOIN pacientes p ON c.paciente_id=p.id
      JOIN terapeutas t ON c.terapeuta_id=t.id
      WHERE c.fecha=CURDATE() ORDER BY c.fecha ASC LIMIT 20
    `);
    res.json({ kpis, citasHoy });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Procesar recordatorios pendientes (llamar desde cron o manualmente)
router.post('/procesar-recordatorios', auth, async (req, res) => {
  if (req.user.rol !== 'superadmin') return res.status(403).json({ error: 'Solo superadmin' });
  const [pendientes] = await pool.execute(`
    SELECT r.*, p.nombre, p.email, p.apellido,
           c.fecha, c.modalidad,
           t.nombre AS t_nombre, t.apellido AS t_apellido
    FROM recordatorios r
    JOIN pacientes p ON r.paciente_id=p.id
    LEFT JOIN citas c ON r.cita_id=c.id
    LEFT JOIN terapeutas t ON c.terapeuta_id=t.id
    WHERE r.enviado=0 AND r.programado_at <= NOW()
    LIMIT 50
  `);
  let enviados = 0;
  for (const rec of pendientes) {
    try {
      if (rec.email) {
        await sendRecordatorioCita(
          { nombre: rec.nombre, email: rec.email },
          { fecha: rec.fecha, modalidad: rec.modalidad },
          { nombre: rec.t_nombre||'tu terapeuta', apellido: rec.t_apellido||'' }
        );
      }
      await pool.execute('UPDATE recordatorios SET enviado=1,enviado_at=NOW() WHERE id=?', [rec.id]);
      enviados++;
    } catch (err) { console.error('[crm/recordatorio]', err.message); }
  }
  res.json({ procesados: pendientes.length, enviados });
});

// Follow-up pacientes inactivos (+15 días sin cita)
router.post('/followup-inactivos', auth, async (req, res) => {
  if (req.user.rol !== 'superadmin') return res.status(403).json({ error: 'Solo superadmin' });
  const [inactivos] = await pool.execute(`
    SELECT p.id, p.nombre, p.email FROM pacientes p
    WHERE p.estado='activo' AND p.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM recordatorios r
      WHERE r.paciente_id=p.id AND r.tipo='reactivacion'
      AND r.created_at >= DATE_SUB(NOW(), INTERVAL 15 DAY)
    )
    AND (
      SELECT MAX(c.fecha) FROM citas c
      WHERE c.paciente_id=p.id AND c.estado='realizada'
    ) <= DATE_SUB(CURDATE(), INTERVAL 15 DAY)
    LIMIT 20
  `);
  let enviados = 0;
  for (const p of inactivos) {
    try {
      await sendFollowUp(p);
      await pool.execute(
        "INSERT INTO recordatorios (paciente_id,tipo,canal,programado_at,enviado,enviado_at) VALUES (?,'reactivacion','email',NOW(),1,NOW())",
        [p.id]
      );
      enviados++;
    } catch (err) { console.error('[crm/followup]', err.message); }
  }
  res.json({ revisados: inactivos.length, enviados });
});

module.exports = router;
