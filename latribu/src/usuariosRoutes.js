const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { seedAccesosForUser } = require('./lib/accesos');

const router = Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}
function isSuperAdmin(req) { return req.user?.rol === 'SUPER_ADMIN'; }

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, nombre, email, rol, activo, es_protegido, fecha_creacion FROM tribu_admins ORDER BY id'
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener usuarios' }); }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { username, password, nombre, email, rol } = req.body;
    if (!username || !password || !nombre || !email)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const validRoles = ['ADMIN', 'SUPER_ADMIN'];
    let userRole = validRoles.includes(rol) ? rol : 'ADMIN';
    if (userRole === 'SUPER_ADMIN' && !isSuperAdmin(req))
      return res.status(403).json({ error: 'Solo el Super Admin puede crear usuarios Super Admin' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO tribu_admins (username, password, nombre, email, rol) VALUES (?, ?, ?, ?, ?)',
      [username, hash, nombre, email, userRole]
    );
    await seedAccesosForUser(result.insertId, userRole);
    res.status(201).json({ id: result.insertId, message: 'Usuario creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El username ya existe' });
    console.error(err); res.status(500).json({ error: 'Error al crear usuario' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const [[user]] = await pool.execute('SELECT es_protegido, rol FROM tribu_admins WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.es_protegido) return res.status(403).json({ error: 'Este usuario no puede ser modificado' });
    if (user.rol === 'SUPER_ADMIN' && !isSuperAdmin(req))
      return res.status(403).json({ error: 'No puedes modificar un Super Admin' });

    const { nombre, email, password, activo } = req.body;
    const campos = [], valores = [];
    if (nombre) { campos.push('nombre = ?'); valores.push(nombre); }
    if (email) { campos.push('email = ?'); valores.push(email); }
    if (password) { campos.push('password = ?'); valores.push(await bcrypt.hash(password, 10)); }
    if (activo !== undefined) { campos.push('activo = ?'); valores.push(activo ? 1 : 0); }
    if (campos.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    valores.push(req.params.id);
    await pool.execute(`UPDATE tribu_admins SET ${campos.join(', ')} WHERE id = ?`, valores);
    res.json({ message: 'Usuario actualizado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar usuario' }); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const [[user]] = await pool.execute('SELECT es_protegido, rol FROM tribu_admins WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.es_protegido) return res.status(403).json({ error: 'Este usuario no puede ser eliminado' });
    if (user.rol === 'SUPER_ADMIN' && !isSuperAdmin(req))
      return res.status(403).json({ error: 'No puedes eliminar un Super Admin' });

    await pool.execute('DELETE FROM tribu_admins WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario eliminado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar usuario' }); }
});

module.exports = router;
