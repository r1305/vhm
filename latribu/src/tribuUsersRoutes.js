const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { requireAcceso } = require('./lib/accesos');
const { solicitarResetPassword, isMailerConfigured } = require('./lib/correosCuenta');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

router.use(authMiddleware, requireAdmin, requireAcceso('tribu-users'));

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = [10, 20, 30, 40, 50].includes(parseInt(req.query.limit)) ? parseInt(req.query.limit) : 10;
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener usuarios tribu' }); }
});

router.post('/:id/enviar-reset', requireAdmin, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Usuario inválido' });
    const [[user]] = await pool.execute('SELECT id, nombre, email FROM tribu_users WHERE id = ? LIMIT 1', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!user.email) return res.status(400).json({ error: 'El usuario no tiene correo' });
    if (!(await isMailerConfigured())) return res.status(503).json({ error: 'El correo (SMTP) no está configurado en el servidor' });
    const r = await solicitarResetPassword(user, { esperarEnvio: true });
    if (!r.enviado) return res.status(502).json({ error: 'No se pudo enviar el correo. Revisa la configuración SMTP.' });
    res.json({ message: 'Enlace para crear contraseña enviado a ' + user.email });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al enviar el enlace' }); }
});

module.exports = router;
