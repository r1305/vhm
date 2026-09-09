const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { auth, authAdmin } = require('../lib/auth');
const { canAssignRole, canManageUser, listFilterForRole } = require('../lib/roles');

const router = Router();

const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;

async function getUserById(id) {
  const [[row]] = await pool.execute(
    'SELECT id, nombre, apellido, username, email, telefono, rol, especialidad, activo FROM terapeutas WHERE id = ?',
    [id]
  );
  return row || null;
}

router.get('/', auth, async (req, res) => {
  try {
    if (!['superadmin', 'admin', 'recepcion', 'terapeuta'].includes(req.user.rol)) {
      return res.status(403).json({ error: 'Sin acceso' });
    }
    const filter = listFilterForRole(req.user.rol);
    const [rows] = await pool.execute(`
      SELECT t.id, t.nombre, t.apellido, t.username, t.email, t.telefono, t.rol, t.especialidad, t.activo,
             MAX(p.installed_at) AS pwa_installed_at
      FROM terapeutas t
      LEFT JOIN pwa_installs p ON p.user_id = t.id
      WHERE 1=1 ${filter.sql}
      GROUP BY t.id
      ORDER BY t.nombre
    `, filter.params);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.post('/', authAdmin, async (req, res) => {
  const { nombre, apellido, username, email, telefono, password, rol = 'terapeuta', especialidad } = req.body || {};
  if (!nombre || !apellido || !username || !password)
    return res.status(400).json({ error: 'nombre, apellido, username y password requeridos' });

  const safeRol = canAssignRole(req.user.rol, rol) ? rol : 'terapeuta';
  if (safeRol !== rol) {
    return res.status(403).json({ error: 'No puedes crear usuarios con ese rol' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.execute(
      'INSERT INTO terapeutas (nombre, apellido, username, email, telefono, password, rol, especialidad) VALUES (?,?,?,?,?,?,?,?)',
      [t(nombre,120), t(apellido,120), t(username,50), t(email,150), t(telefono,30), hash, safeRol, t(especialidad,200)]
    );
    const { seedMenuPermisosFromRol } = require('../lib/menuPermisos');
    await seedMenuPermisosFromRol(r.insertId, safeRol);
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El username ya existe' });
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

router.put('/:id', authAdmin, async (req, res) => {
  const { nombre, apellido, username, especialidad, bio, activo, password, telefono, rol } = req.body || {};
  const id = parseInt(req.params.id, 10);
  const target = await getUserById(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!canManageUser(req.user, target)) {
    return res.status(403).json({ error: 'No puedes editar este usuario' });
  }

  try {
    const sets = ['nombre=?','apellido=?','especialidad=?','bio=?','activo=?','telefono=?'];
    const vals = [t(nombre,120), t(apellido,120), t(especialidad,200), t(bio,2000), activo ? 1 : 0, t(telefono,30)];

    if (username) { sets.push('username=?'); vals.push(t(username,50)); }
    if (password) { sets.push('password=?'); vals.push(await bcrypt.hash(password, 10)); }

    if (rol && rol !== target.rol) {
      if (!canAssignRole(req.user.rol, rol)) {
        return res.status(403).json({ error: 'No puedes asignar ese rol' });
      }
      sets.push('rol=?');
      vals.push(rol);
    }

    vals.push(id);
    await pool.execute(`UPDATE terapeutas SET ${sets.join(',')} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
});

router.get('/:id/disponibilidad', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM disponibilidad WHERE terapeuta_id = ? AND activo = 1 ORDER BY dia_semana, hora_inicio',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/disponibilidad', auth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.rol === 'terapeuta' && req.user.id !== id)
    return res.status(403).json({ error: 'Sin acceso' });
  const { dia_semana, hora_inicio, hora_fin } = req.body || {};
  await pool.execute(
    'INSERT INTO disponibilidad (terapeuta_id, dia_semana, hora_inicio, hora_fin) VALUES (?,?,?,?)',
    [id, dia_semana, hora_inicio, hora_fin]
  );
  res.status(201).json({ ok: true });
});

router.delete('/:id/disponibilidad/:did', auth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.rol === 'terapeuta' && req.user.id !== id)
    return res.status(403).json({ error: 'Sin acceso' });
  await pool.execute('DELETE FROM disponibilidad WHERE id=? AND terapeuta_id=?', [req.params.did, id]);
  res.json({ ok: true });
});

module.exports = router;
