const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { auth, authAdmin } = require('../lib/auth');

const router = Router();

const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;

router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nombre, apellido, email, rol, especialidad, activo FROM terapeutas ORDER BY nombre'
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.post('/', authAdmin, async (req, res) => {
  const { nombre, apellido, username, email, password, rol = 'terapeuta', especialidad } = req.body || {};
  if (!nombre || !apellido || !username || !password)
    return res.status(400).json({ error: 'nombre, apellido, username y password requeridos' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.execute(
      'INSERT INTO terapeutas (nombre, apellido, username, email, password, rol, especialidad) VALUES (?,?,?,?,?,?,?)',
      [t(nombre,120), t(apellido,120), t(username,50), t(email,150), hash, rol, t(especialidad,200)]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El username ya existe' });
    res.status(500).json({ error: 'Error al crear terapeuta' });
  }
});

router.put('/:id', authAdmin, async (req, res) => {
  const { nombre, apellido, especialidad, bio, activo, password } = req.body || {};
  const id = parseInt(req.params.id, 10);
  try {
    const sets = ['nombre=?','apellido=?','especialidad=?','bio=?','activo=?'];
    const vals = [t(nombre,120), t(apellido,120), t(especialidad,200), t(bio,2000), activo ? 1 : 0];
    if (password) { sets.push('password=?'); vals.push(await bcrypt.hash(password, 10)); }
    vals.push(id);
    await pool.execute(`UPDATE terapeutas SET ${sets.join(',')} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
});

// Disponibilidad horaria
router.get('/:id/disponibilidad', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM disponibilidad WHERE terapeuta_id = ? AND activo = 1 ORDER BY dia_semana, hora_inicio',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/disponibilidad', authAdmin, async (req, res) => {
  const { dia_semana, hora_inicio, hora_fin } = req.body || {};
  await pool.execute(
    'INSERT INTO disponibilidad (terapeuta_id, dia_semana, hora_inicio, hora_fin) VALUES (?,?,?,?)',
    [req.params.id, dia_semana, hora_inicio, hora_fin]
  );
  res.status(201).json({ ok: true });
});

router.delete('/:id/disponibilidad/:did', authAdmin, async (req, res) => {
  await pool.execute('UPDATE disponibilidad SET activo=0 WHERE id=? AND terapeuta_id=?', [req.params.did, req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
