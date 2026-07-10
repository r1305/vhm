const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { signToken, auth } = require('../lib/auth');

const router = Router();

// Rate limiter simple para login
const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (now - v.first > 15 * 60 * 1000) loginAttempts.delete(k);
  }
}, 5 * 60 * 1000);

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const key = (req.ip || req.connection?.remoteAddress || '') + ':' + String(username).trim().toLowerCase();
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.count >= 5 && now - entry.first < 15 * 60 * 1000) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }

  try {
    const [[user]] = await pool.execute(
      'SELECT id, nombre, apellido, username, email, password, rol, especialidad FROM terapeutas WHERE username = ? AND activo = 1 LIMIT 1',
      [String(username).trim()]
    );
    if (!user || !(await bcrypt.compare(password, user.password))) {
      if (!entry || now - entry.first > 15 * 60 * 1000) {
        loginAttempts.set(key, { count: 1, first: now });
      } else {
        entry.count++;
      }
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    loginAttempts.delete(key);
    const { password: _, ...safe } = user;
    res.json({ token: signToken({ id: user.id, rol: user.rol, nombre: user.nombre }), user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const [[user]] = await pool.execute(
      'SELECT id, nombre, apellido, username, email, rol, especialidad, bio FROM terapeutas WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
