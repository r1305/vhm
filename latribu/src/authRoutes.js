const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { JWT_SECRET } = require('./auth');
const { ensureSchema } = require('./schema');
const { getAccesosForUser } = require('./lib/accesos');

const router = Router();

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function getAttempts(ip) {
  const r = loginAttempts.get(ip);
  if (!r || Date.now() - r.start > WINDOW_MS) return null;
  return r;
}
function recordAttempt(ip) {
  const r = loginAttempts.get(ip);
  if (!r || Date.now() - r.start > WINDOW_MS) loginAttempts.set(ip, { count: 1, start: Date.now() });
  else r.count++;
}
function resetAttempts(ip) { loginAttempts.delete(ip); }
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of loginAttempts) if (now - r.start > WINDOW_MS) loginAttempts.delete(ip);
}, 30 * 60 * 1000).unref();

router.post('/login', async (req, res) => {
  try {
    await ensureSchema();
    const ip = req.ip || req.connection.remoteAddress;
    const record = getAttempts(ip);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta de nuevo en ${remaining} minuto(s).` });
    }

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const [rows] = await pool.execute('SELECT * FROM tribu_admins WHERE username = ? AND activo = 1', [username]);
    if (rows.length === 0) { recordAttempt(ip); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordAttempt(ip); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    resetAttempts(ip);
    const menuItems = await getAccesosForUser(user.id, user.rol);
    const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    res.json({
      token,
      user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, menuItems },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el login' });
  }
});

module.exports = router;
