const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin, ownerFilter } = require('../lib/auth');

const router = Router();
const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const id = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };
const tribuProvision = require('../lib/tribuProvision');
const {
  loadPacientePaquetes,
  createPacientePaquete,
  markCuotaPagada,
} = require('../lib/paquetesPaciente');

router.get('/conteo-por-terapeuta', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT terapeuta_id, COUNT(*) AS total FROM pacientes WHERE terapeuta_id IS NOT NULL GROUP BY terapeuta_id'
    );
    const map = {};
    rows.forEach(r => { map[r.terapeuta_id] = r.total; });
    res.json(map);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.get('/', auth, async (req, res) => {
  try {
    const q = t(req.query.q, 80);
    const estado = t(req.query.estado, 20);
    const tid = id(req.query.terapeuta_id);
    const sinTel   = req.query.sin_telefono === '1';
    const sinEmail = req.query.sin_email    === '1';
    const of = ownerFilter(req, 'p');
    let sql = `SELECT p.*, t.nombre AS terapeuta_nombre,
               COALESCE(
                 (SELECT pp.sesiones FROM paciente_paquetes pp
                  WHERE pp.paciente_id = p.id AND pp.activo = 1
                    AND pp.fecha_inicio <= CURDATE()
                    AND (pp.vence_at IS NULL OR pp.vence_at >= CURDATE())
                  ORDER BY pp.fecha_inicio ASC, pp.id ASC LIMIT 1),
                 (SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = p.id),
                 0
               ) AS sesiones_total,
               COALESCE(
                 (SELECT COUNT(*) FROM citas c
                  WHERE c.paciente_id = p.id
                    AND c.paciente_paquete_id = (
                      SELECT pp.id FROM paciente_paquetes pp
                      WHERE pp.paciente_id = p.id AND pp.activo = 1
                        AND pp.fecha_inicio <= CURDATE()
                        AND (pp.vence_at IS NULL OR pp.vence_at >= CURDATE())
                      ORDER BY pp.fecha_inicio ASC, pp.id ASC LIMIT 1
                    )
                    AND c.estado NOT IN ('cancelada','no_show')),
                 (SELECT COUNT(*) FROM citas c
                  WHERE c.paciente_id = p.id AND c.estado NOT IN ('cancelada','no_show')),
                 0
               ) AS citas_confirmadas,
               (SELECT pp.nombre FROM paciente_paquetes pp
                 WHERE pp.paciente_id = p.id AND pp.activo = 1
                   AND pp.fecha_inicio <= CURDATE()
                   AND (pp.vence_at IS NULL OR pp.vence_at >= CURDATE())
                 ORDER BY pp.fecha_inicio ASC, pp.id ASC LIMIT 1) AS paquete_nombre,
               (SELECT COUNT(*) FROM paciente_paquetes pp WHERE pp.paciente_id = p.id) AS paquetes_total
               FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id WHERE 1=1`;
    const params = [];
    if (q) { sql += ' AND (p.nombre LIKE ? OR p.apellido LIKE ? OR p.email LIKE ? OR p.telefono LIKE ?)'; const l=`%${q}%`; params.push(l,l,l,l); }
    if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
    if (tid)    { sql += ' AND p.terapeuta_id = ?'; params.push(tid); }
    if (sinTel)   sql += ' AND (p.telefono IS NULL OR p.telefono = "")';
    if (sinEmail) sql += ' AND (p.email IS NULL OR p.email = "")';
    sql += of.sql; params.push(...of.params);
    sql += ' ORDER BY p.updated_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    try {
      await tribuProvision.attachTribuFlagsToPacientes(rows);
    } catch {
      rows.forEach(p => { p.tribu_user_id = null; });
    }
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al listar pacientes' }); }
});

router.post('/tribu/rebuild-suscripciones', authAdmin, async (req, res) => {
  try {
    const result = await tribuProvision.rebuildAllTribuSubscriptions();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al reconstruir suscripciones' });
  }
});

router.post('/:pid/tribu-usuario', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const [[p]] = await pool.execute('SELECT * FROM pacientes WHERE id = ?', [pid]);
    if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (p.email) {
      const existing = await tribuProvision.findTribuUserByEmail(p.email);
      if (existing) return res.status(409).json({ error: 'Este paciente ya tiene usuario Tribu' });
    }
    const result = await tribuProvision.createTribuUserFromPaciente(p);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    const code = err.message?.includes('Ya existe') ? 409 : 500;
    res.status(code).json({ error: err.message || 'Error al crear usuario Tribu' });
  }
});

router.post('/', authAdmin, async (req, res) => {
  const { nombre, apellido, email, telefono, fecha_nacimiento, genero,
          motivo_consulta, fuente, fuente_detalle, terapeuta_id, estado = 'prospecto' } = req.body || {};
  if (!nombre || !apellido) return res.status(400).json({ error: 'nombre y apellido requeridos' });
  try {
    const tid = id(terapeuta_id) || (req.user.rol === 'terapeuta' ? req.user.id : null);
    const [r] = await pool.execute(
      `INSERT INTO pacientes (nombre,apellido,email,telefono,fecha_nacimiento,genero,
        motivo_consulta,fuente,fuente_detalle,terapeuta_id,estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       fecha_nacimiento||null, genero||null,
       t(motivo_consulta,2000),t(fuente,80),t(fuente_detalle,300),tid,estado]
    );
    res.status(201).json({ id: r.insertId });
  } catch { res.status(500).json({ error: 'Error al crear paciente' }); }
});

router.get('/:pid', auth, async (req, res) => {
  try {
    const [[p]] = await pool.execute(
      `SELECT p.*, t.nombre AS terapeuta_nombre, t.apellido AS terapeuta_apellido
       FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id WHERE p.id = ?`,
      [req.params.pid]
    );
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    if (req.user.rol === 'terapeuta' && p.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    res.json(p);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.put('/:pid', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, apellido, email, telefono, fecha_nacimiento, genero,
          motivo_consulta, fuente, fuente_detalle, terapeuta_id, estado } = req.body || {};
  try {
    await pool.execute(
      `UPDATE pacientes SET nombre=?,apellido=?,email=?,telefono=?,fecha_nacimiento=?,genero=?,
       motivo_consulta=?,fuente=?,fuente_detalle=?,terapeuta_id=?,estado=?
       WHERE id=?`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       fecha_nacimiento||null, genero||null,
       t(motivo_consulta,2000),t(fuente,80),t(fuente_detalle,300),
       id(terapeuta_id),estado,pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
});

// ── Resumen de sesiones (legacy + paquetes) ──────────
router.get('/:pid/sesiones-resumen', auth, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Sesiones legacy registradas
    const [[legacy]] = await pool.execute(
      'SELECT COALESCE(SUM(sesiones), 0) AS total FROM paciente_sesiones WHERE paciente_id = ?',
      [pid]
    );
    // Citas tomadas (no canceladas/no_show) sin paciente_paquete_id (legacy)
    const [[citasLegacy]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM citas
       WHERE paciente_id = ? AND paciente_paquete_id IS NULL AND estado NOT IN ('cancelada','no_show')`,
      [pid]
    );
    const sesionesLegacy = Number(legacy.total) || 0;
    const citasLegacyUsadas = Number(citasLegacy.total) || 0;
    res.json({
      sesiones_registradas: sesionesLegacy,
      citas_tomadas: citasLegacyUsadas,
      pendientes: Math.max(0, sesionesLegacy - citasLegacyUsadas),
    });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// ── Paquetes adquiridos por paciente ──────────────────────────
router.get('/:pid/paquetes-adquiridos', auth, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const paquetes = await loadPacientePaquetes(pid);
    res.json(paquetes);
  } catch {
    res.status(500).json({ error: 'Error al cargar paquetes' });
  }
});

router.post('/:pid/paquetes-adquiridos', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const paqueteId = await createPacientePaquete(pid, req.body || {});
    const paquetes = await loadPacientePaquetes(pid);
    res.status(201).json({ id: paqueteId, paquetes });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al asignar paquete' });
  }
});

router.patch('/:pid/paquetes-adquiridos/:pkgId', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  const pkgId = id(req.params.pkgId);
  if (!pid || !pkgId) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, fecha_inicio, sesiones, precio } = req.body || {};
  try {
    const [[pkg]] = await pool.execute(
      'SELECT id FROM paciente_paquetes WHERE id = ? AND paciente_id = ?', [pkgId, pid]
    );
    if (!pkg) return res.status(404).json({ error: 'Paquete no encontrado' });
    const fields = [];
    const vals = [];
    if (nombre != null)       { fields.push('nombre = ?');       vals.push(t(nombre, 200)); }
    if (fecha_inicio != null) { fields.push('fecha_inicio = ?'); vals.push(fecha_inicio); }
    if (sesiones != null)     { fields.push('sesiones = ?');     vals.push(Math.max(1, parseInt(sesiones, 10) || 1)); }
    if (precio != null)       { fields.push('precio = ?');       vals.push(Math.max(0, Number(precio) || 0)); }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(pkgId);
    await pool.execute(`UPDATE paciente_paquetes SET ${fields.join(', ')} WHERE id = ?`, vals);
    const paquetes = await loadPacientePaquetes(pid);
    res.json({ ok: true, paquetes });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar paquete' });
  }
});

router.patch('/:pid/paquetes-adquiridos/cuotas/:cuotaId/pagar', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  const cuotaId = id(req.params.cuotaId);
  if (!pid || !cuotaId) return res.status(400).json({ error: 'ID inválido' });
  try {
    await markCuotaPagada(pid, cuotaId);
    const paquetes = await loadPacientePaquetes(pid);
    res.json({ ok: true, paquetes });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al registrar pago' });
  }
});

// ── Sesiones por paciente (legacy) ────────────────────────────
router.get('/:pid/sesiones', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM paciente_sesiones WHERE paciente_id=? ORDER BY fecha_inicio ASC, id ASC',
      [req.params.pid]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.post('/:pid/sesiones', auth, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  const { fecha_inicio, sesiones } = req.body || {};
  try {
    const [r] = await pool.execute(
      'INSERT INTO paciente_sesiones (paciente_id, fecha_inicio, sesiones) VALUES (?,?,?)',
      [pid, fecha_inicio||null, parseInt(sesiones,10)||0]
    );
    res.status(201).json({ id: r.insertId });
  } catch { res.status(500).json({ error: 'Error al crear' }); }
});

router.put('/:pid/sesiones/:sid', auth, async (req, res) => {
  const sid = id(req.params.sid);
  if (!sid) return res.status(400).json({ error: 'ID inválido' });
  const { fecha_inicio, sesiones } = req.body || {};
  try {
    await pool.execute(
      'UPDATE paciente_sesiones SET fecha_inicio=?, sesiones=? WHERE id=? AND paciente_id=?',
      [fecha_inicio||null, parseInt(sesiones,10)||0, sid, req.params.pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
});

router.delete('/:pid/sesiones/:sid', auth, async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM paciente_sesiones WHERE id=? AND paciente_id=?',
      [req.params.sid, req.params.pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al eliminar' }); }
});

// Consentimiento informado
router.post('/:pid/consentimiento', auth, async (req, res) => {
  const pid = id(req.params.pid);
  const ip = req.ip || '';
  await pool.execute(
    'UPDATE pacientes SET consentimiento=1, consentimiento_at=NOW() WHERE id=?', [pid]
  );
  await pool.execute(
    `INSERT INTO consentimientos (paciente_id, tipo, texto, firmado, firmado_at, ip_firma)
     VALUES (?,?,?,1,NOW(),?)`,
    [pid, req.body.tipo||'terapeutico', req.body.texto||'Consentimiento informado firmado digitalmente.', ip]
  );
  res.json({ ok: true });
});

module.exports = router;
