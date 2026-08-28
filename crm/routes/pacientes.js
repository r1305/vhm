const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin, ownerFilter } = require('../lib/auth');

const router = Router();
const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const id = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };
const tribuProvision = require('../lib/tribuProvision');

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
    const of = ownerFilter(req, 'p');
    let sql = `SELECT p.*, t.nombre AS terapeuta_nombre,
               COALESCE((SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = p.id), 0) AS sesiones_total,
               COALESCE((SELECT COUNT(*) FROM citas c WHERE c.paciente_id = p.id AND c.estado IN ('realizada','no_show')), 0) AS citas_confirmadas
               FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id WHERE 1=1`;
    const params = [];
    if (q) { sql += ' AND (p.nombre LIKE ? OR p.apellido LIKE ? OR p.email LIKE ? OR p.telefono LIKE ?)'; const l=`%${q}%`; params.push(l,l,l,l); }
    if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
    if (tid)    { sql += ' AND p.terapeuta_id = ?'; params.push(tid); }
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

// ── Sesiones por paciente ─────────────────────────────────────
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
