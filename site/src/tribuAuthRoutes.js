const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');
const { JWT_SECRET } = require('./auth');

const router = Router();

const TRIBU_JWT_SECRET = JWT_SECRET + '_tribu';

// Rate limiter en memoria
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

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, tribu: true }, TRIBU_JWT_SECRET, { expiresIn: '7d' });
}

function tribuAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, TRIBU_JWT_SECRET);
    if (!payload.tribu) return res.status(401).json({ error: 'Token inválido' });
    req.tribuUser = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// POST /api/tribu-auth/login
router.post('/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const record = getAttempts(ip);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta en ${remaining} minuto(s).` });
    }

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const [rows] = await pool.execute(
      'SELECT id, nombre, apellido, email, password, psw_temp, is_suscribed FROM tribu_users WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if (!rows.length) { recordAttempt(ip); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordAttempt(ip); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    resetAttempts(ip);
    const token = signToken(user);

    // Verificar suscripción activa vigente
    const [sus] = await pool.execute(
      `SELECT ts.id, s.nombre, ts.fecha_fin
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       WHERE ts.tribu_user_id = ? AND ts.activo = 1 AND ts.fecha_fin >= CURDATE()
       ORDER BY ts.fecha_fin DESC LIMIT 1`,
      [user.id]
    );
    const suscripcion_activa = sus.length > 0 ? { nombre: sus[0].nombre, fecha_fin: sus[0].fecha_fin } : null;

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, apellido: user.apellido, email: user.email, psw_temp: !!user.psw_temp, is_suscribed: !!user.is_suscribed, suscripcion_activa }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el login' });
  }
});

// POST /api/tribu-auth/registro
router.post('/registro', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!nombre || !apellido || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (password.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const emailNorm = email.trim().toLowerCase();
    const [existe] = await pool.execute('SELECT id FROM tribu_users WHERE email = ? LIMIT 1', [emailNorm]);
    if (existe.length) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      `INSERT INTO tribu_users (nombre, apellido, email, password, psw_temp, is_suscribed, estado)
       VALUES (?, ?, ?, ?, 0, 0, 'prospecto')`,
      [nombre.trim(), apellido.trim(), emailNorm, hash]
    );
    const user = { id: result.insertId, nombre: nombre.trim(), apellido: apellido.trim(), email: emailNorm };
    const token = signToken(user);
    res.status(201).json({ token, user: { ...user, psw_temp: false, is_suscribed: false } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

// POST /api/tribu-auth/recuperar  — genera token y lo guarda (sin email por ahora, devuelve el token)
router.post('/recuperar', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const emailNorm = email.trim().toLowerCase();
    const [rows] = await pool.execute('SELECT id FROM tribu_users WHERE email = ? LIMIT 1', [emailNorm]);
    // Siempre responder igual para no revelar si el email existe
    if (!rows.length) return res.json({ message: 'Si el correo existe, recibirás instrucciones.' });

    const token = crypto.randomBytes(24).toString('hex');
    const expira = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await pool.execute(
      'UPDATE tribu_users SET reset_token = ?, reset_token_exp = ? WHERE id = ?',
      [token, expira, rows[0].id]
    );

    // TODO: enviar email con el token cuando esté configurado el mailer
    res.json({ message: 'Si el correo existe, recibirás instrucciones.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// POST /api/tribu-auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const [rows] = await pool.execute(
      'SELECT id FROM tribu_users WHERE reset_token = ? AND reset_token_exp > NOW() LIMIT 1',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Token inválido o expirado' });

    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      'UPDATE tribu_users SET password = ?, psw_temp = 0, reset_token = NULL, reset_token_exp = NULL, password_plain = NULL WHERE id = ?',
      [hash, rows[0].id]
    );
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
});

// GET /api/tribu-auth/me
router.get('/me', tribuAuthMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nombre, apellido, email, psw_temp, is_suscribed FROM tribu_users WHERE id = ? LIMIT 1',
      [req.tribuUser.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = rows[0];

    // Verificar suscripción activa vigente
    const [sus] = await pool.execute(
      `SELECT ts.id, s.nombre, ts.fecha_fin
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       WHERE ts.tribu_user_id = ? AND ts.activo = 1 AND ts.fecha_fin >= CURDATE()
       ORDER BY ts.fecha_fin DESC LIMIT 1`,
      [user.id]
    );
    user.suscripcion_activa = sus.length > 0 ? { nombre: sus[0].nombre, fecha_fin: sus[0].fecha_fin } : null;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

module.exports = { router, tribuAuthMiddleware };
