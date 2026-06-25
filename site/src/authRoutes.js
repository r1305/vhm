const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { JWT_SECRET } = require('./auth');

const router = Router();

// Rate limiter en memoria: max 5 intentos por IP en 15 minutos
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function getAttempts(ip) {
  const record = loginAttempts.get(ip);
  if (!record || Date.now() - record.start > WINDOW_MS) return null;
  return record;
}

function recordAttempt(ip) {
  const record = loginAttempts.get(ip);
  if (!record || Date.now() - record.start > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, start: Date.now() });
  } else {
    record.count++;
  }
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

// Limpiar entradas expiradas cada 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.start > WINDOW_MS) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

router.post('/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const record = getAttempts(ip);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta de nuevo en ${remaining} minuto(s).` });
    }

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contrase\u00f1a requeridos' });

    const [rows] = await pool.execute('SELECT * FROM usuarios WHERE username = ? AND activo = 1', [username]);
    if (rows.length === 0) {
      recordAttempt(ip);
      return res.status(401).json({ error: 'Credenciales inv\u00e1lidas' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      recordAttempt(ip);
      return res.status(401).json({ error: 'Credenciales inv\u00e1lidas' });
    }

    resetAttempts(ip);
    const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el login' });
  }
});

module.exports = router;
