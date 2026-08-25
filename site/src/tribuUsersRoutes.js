const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

router.get('/', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = [10, 20, 30, 40, 50].includes(parseInt(req.query.limit)) ? parseInt(req.query.limit) : 10;
    const offset = (page - 1) * limit;
    const q      = (req.query.q || '').trim();

    let where = '1=1';
    const params = [];
    if (q) {
      where += ' AND (nombre LIKE ? OR apellido LIKE ? OR email LIKE ? OR telefono LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM tribu_users WHERE ${where}`, params);
    const [rows] = await pool.query(
      `SELECT id, nombre, apellido, email, telefono, estado, is_suscribed, psw_temp, created_at
       FROM tribu_users WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data: rows, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios tribu' });
  }
});

// GET contraseña temporal de un usuario (solo si psw_temp = 1)
router.get('/:id/password-temp', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT password_plain FROM tribu_users WHERE id = ? AND psw_temp = 1 LIMIT 1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No hay contraseña temporal para este usuario' });
    res.json({ password: rows[0].password_plain || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener contraseña' });
  }
});

module.exports = router;
