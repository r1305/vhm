const { Router } = require('express');
const pool = require('../lib/db');
const { auth, ownerFilter } = require('../lib/auth');

const router = Router();
const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const id = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };

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
    let sql = `SELECT p.*, t.nombre AS terapeuta_nombre
               FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id WHERE 1=1`;
    const params = [];
    if (q) { sql += ' AND (p.nombre LIKE ? OR p.apellido LIKE ? OR p.email LIKE ? OR p.telefono LIKE ?)'; const l=`%${q}%`; params.push(l,l,l,l); }
    if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
    if (tid)    { sql += ' AND p.terapeuta_id = ?'; params.push(tid); }
    sql += of.sql; params.push(...of.params);
    sql += ' ORDER BY p.updated_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al listar pacientes' }); }
});

router.post('/', auth, async (req, res) => {
  const { nombre, apellido, email, telefono, fecha_nacimiento, genero,
          motivo_consulta, fuente, fuente_detalle, terapeuta_id, estado = 'prospecto',
          fecha_inicio, sesiones } = req.body || {};
  if (!nombre || !apellido) return res.status(400).json({ error: 'nombre y apellido requeridos' });
  try {
    const tid = id(terapeuta_id) || (req.user.rol === 'terapeuta' ? req.user.id : null);
    const [r] = await pool.execute(
      `INSERT INTO pacientes (nombre,apellido,email,telefono,fecha_nacimiento,genero,
        motivo_consulta,fuente,fuente_detalle,terapeuta_id,estado,fecha_inicio,sesiones)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       fecha_nacimiento||null, genero||null,
       t(motivo_consulta,2000),t(fuente,80),t(fuente_detalle,300),tid,estado,
       fecha_inicio||null, sesiones!=null ? parseInt(sesiones,10)||null : null]
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
    // terapeuta solo puede ver sus propios pacientes
    if (req.user.rol === 'terapeuta' && p.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    res.json(p);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.put('/:pid', auth, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, apellido, email, telefono, fecha_nacimiento, genero,
          motivo_consulta, fuente, fuente_detalle, terapeuta_id,
          estado, notas_internas, fecha_inicio, sesiones } = req.body || {};
  try {
    await pool.execute(
      `UPDATE pacientes SET nombre=?,apellido=?,email=?,telefono=?,fecha_nacimiento=?,genero=?,
       motivo_consulta=?,fuente=?,fuente_detalle=?,terapeuta_id=?,estado=?,notas_internas=?,
       fecha_inicio=?,sesiones=?
       WHERE id=?`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       fecha_nacimiento||null, genero||null,
       t(motivo_consulta,2000),t(fuente,80),t(fuente_detalle,300),
       id(terapeuta_id),estado,t(notas_internas,5000),
       fecha_inicio||null, sesiones!=null ? parseInt(sesiones,10)||null : null,
       pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
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
