const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('./db');
const { JWT_SECRET } = require('./auth');

const router = Router();
const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/tribu');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uid = req.tribuUser?.id || 'x';
    cb(null, `avatar_${uid}_${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (jpg, png, webp, gif)'));
  },
});

function sanitizeName(str, max = 120) {
  return String(str || '').trim().slice(0, max);
}
function sanitizePhone(str) {
  return String(str || '').replace(/[^\d+]/g, '').slice(0, 30) || null;
}
function sanitizeEmail(str) {
  const e = String(str || '').trim().toLowerCase().slice(0, 150);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

function deleteFotoFile(fotoUrl) {
  if (!fotoUrl) return;
  const match = String(fotoUrl).match(/\/uploads\/tribu\/[^?#]+/);
  if (!match) return;
  const filePath = path.join(__dirname, '../public', match[0].replace(/^\//, ''));
  fs.unlink(filePath, () => {});
}

async function fetchUserPublic(id) {
  const [rows] = await pool.execute(
    'SELECT id, nombre, apellido, email, telefono, foto_url, psw_temp, is_suscribed FROM tribu_users WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) return null;
  const user = rows[0];

  const [sus] = await pool.execute(
    `SELECT ts.id, s.nombre, ts.fecha_fin
     FROM tribu_suscripciones ts
     JOIN suscripciones s ON s.id = ts.suscripcion_id
     WHERE ts.tribu_user_id = ? AND ts.activo = 1 AND ts.fecha_fin >= CURDATE()
     ORDER BY ts.fecha_fin DESC LIMIT 1`,
    [id]
  );
  user.suscripcion_activa = sus.length > 0 ? { nombre: sus[0].nombre, fecha_fin: sus[0].fecha_fin } : null;
  user.psw_temp = !!user.psw_temp;
  user.is_suscribed = !!user.is_suscribed;
  return user;
}

function userPayload(user) {
  return {
    id: user.id,
    nombre: user.nombre,
    apellido: user.apellido,
    email: user.email,
    telefono: user.telefono || null,
    foto_url: user.foto_url || null,
    psw_temp: !!user.psw_temp,
    is_suscribed: !!user.is_suscribed,
    suscripcion_activa: user.suscripcion_activa || null,
  };
}

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
    const profile = await fetchUserPublic(user.id);

    res.json({
      token,
      user: userPayload(profile || user),
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

async function ensureTempPasswordPlain(userId, currentPlain) {
  if (currentPlain) return currentPlain;
  const plain = crypto.randomBytes(4).toString('hex').toUpperCase();
  const hash = await bcrypt.hash(plain, 10);
  await pool.execute(
    'UPDATE tribu_users SET password = ?, password_plain = ? WHERE id = ?',
    [hash, plain, userId]
  );
  return plain;
}

// POST /api/tribu-auth/recuperar — usuarios con psw_temp: muestra contraseña temporal en pantalla
router.post('/recuperar', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const record = getAttempts(ip);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta en ${remaining} minuto(s).` });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const emailNorm = email.trim().toLowerCase();
    const [rows] = await pool.execute(
      'SELECT id, psw_temp, password_plain FROM tribu_users WHERE email = ? LIMIT 1',
      [emailNorm]
    );

    if (!rows.length) {
      recordAttempt(ip);
      return res.json({ temp: false, message: 'Si el correo existe y tiene contraseña temporal, podrás continuar.' });
    }

    const user = rows[0];
    if (!user.psw_temp) {
      return res.json({ temp: false, message: 'Si el correo existe, recibirás instrucciones por correo cuando esté disponible.' });
    }

    resetAttempts(ip);
    const tempPassword = await ensureTempPasswordPlain(user.id, user.password_plain);
    res.json({
      temp: true,
      tempPassword,
      message: 'Esta es tu contraseña temporal. Ingrésala a continuación y crea una nueva contraseña.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// POST /api/tribu-auth/cambiar-password-temp — valida temporal y fija contraseña definitiva
router.post('/cambiar-password-temp', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const record = getAttempts(ip);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta en ${remaining} minuto(s).` });
    }

    const { email, tempPassword, newPassword } = req.body;
    if (!email || !tempPassword || !newPassword) {
      return res.status(400).json({ error: 'Correo, contraseña temporal y nueva contraseña son requeridos' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const emailNorm = email.trim().toLowerCase();
    const [rows] = await pool.execute(
      'SELECT id, password FROM tribu_users WHERE email = ? AND psw_temp = 1 LIMIT 1',
      [emailNorm]
    );
    if (!rows.length) {
      recordAttempt(ip);
      return res.status(400).json({ error: 'No se encontró una cuenta con contraseña temporal para ese correo' });
    }

    const valid = await bcrypt.compare(String(tempPassword), rows[0].password);
    if (!valid) {
      recordAttempt(ip);
      return res.status(401).json({ error: 'Contraseña temporal incorrecta' });
    }

    resetAttempts(ip);
    const hash = await bcrypt.hash(String(newPassword), 12);
    await pool.execute(
      'UPDATE tribu_users SET password = ?, psw_temp = 0, password_plain = NULL, reset_token = NULL, reset_token_exp = NULL WHERE id = ?',
      [hash, rows[0].id]
    );
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
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
    const user = await fetchUserPublic(req.tribuUser.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(userPayload(user));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// PUT /api/tribu-auth/perfil
router.put('/perfil', tribuAuthMiddleware, async (req, res) => {
  try {
    const nombre = sanitizeName(req.body.nombre);
    const apellido = sanitizeName(req.body.apellido);
    const email = sanitizeEmail(req.body.email);
    const telefono = sanitizePhone(req.body.telefono);

    if (!nombre || !apellido) return res.status(400).json({ error: 'Nombre y apellido son obligatorios' });
    if (!email) return res.status(400).json({ error: 'Correo electrónico inválido' });

    const [existing] = await pool.execute(
      'SELECT id FROM tribu_users WHERE email = ? AND id != ? LIMIT 1',
      [email, req.tribuUser.id]
    );
    if (existing.length) return res.status(409).json({ error: 'Ese correo ya está en uso' });

    await pool.execute(
      'UPDATE tribu_users SET nombre = ?, apellido = ?, email = ?, telefono = ? WHERE id = ?',
      [nombre, apellido, email, telefono, req.tribuUser.id]
    );

    const user = await fetchUserPublic(req.tribuUser.id);
    const token = signToken(user);
    res.json({ user: userPayload(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el perfil' });
  }
});

// POST /api/tribu-auth/perfil/foto
router.post('/perfil/foto', tribuAuthMiddleware, (req, res) => {
  uploadAvatar.single('foto')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Archivo no válido' });
    if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen' });

    try {
      const [rows] = await pool.execute('SELECT foto_url FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]);
      const oldUrl = rows[0]?.foto_url;
      const foto_url = `${BASE}/uploads/tribu/${req.file.filename}`;

      await pool.execute('UPDATE tribu_users SET foto_url = ? WHERE id = ?', [foto_url, req.tribuUser.id]);
      if (oldUrl && oldUrl !== foto_url) deleteFotoFile(oldUrl);

      const user = await fetchUserPublic(req.tribuUser.id);
      res.json({ foto_url, user: userPayload(user) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al subir la foto' });
    }
  });
});

// DELETE /api/tribu-auth/perfil/foto
router.delete('/perfil/foto', tribuAuthMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT foto_url FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]);
    if (rows[0]?.foto_url) deleteFotoFile(rows[0].foto_url);
    await pool.execute('UPDATE tribu_users SET foto_url = NULL WHERE id = ?', [req.tribuUser.id]);
    const user = await fetchUserPublic(req.tribuUser.id);
    res.json({ user: userPayload(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al quitar la foto' });
  }
});

// GET /api/tribu-auth/suscripciones
router.get('/suscripciones', tribuAuthMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ts.id, ts.fecha_inicio, ts.fecha_fin, ts.activo,
              s.nombre, s.precio, s.descripcion
       FROM tribu_suscripciones ts
       JOIN suscripciones s ON s.id = ts.suscripcion_id
       WHERE ts.tribu_user_id = ?
       ORDER BY ts.fecha_inicio DESC`,
      [req.tribuUser.id]
    );
    const hoy = new Date().toISOString().slice(0, 10);
    const data = rows.map(r => ({
      id: r.id,
      nombre: r.nombre,
      precio: r.precio,
      descripcion: r.descripcion,
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin,
      activo: !!(r.activo && String(r.fecha_fin).slice(0, 10) >= hoy),
    }));
    res.json({ data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener suscripciones' });
  }
});

module.exports = { router, tribuAuthMiddleware };
