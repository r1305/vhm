const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const {
  listSavedCards, getSavedCard, getDefaultSavedCard, setDefaultCard, deactivateSavedCard,
} = require('./tribuSavedCards');
const { crearUploadImagen, guardarImagen, borrarImagen } = require('./lib/subidaImagen');
const { JWT_SECRET } = require('./auth');
const { sanitizeName, sanitizePhone, sanitizeEmail, toYmd } = require('../lib/validation');
const { accesoVigenteSql, sincronizarIsSuscribed } = require('./lib/suscripcionAcceso');
const { crearLimitador, ipDe, responder429 } = require('./lib/rateLimitMemoria');
const {
  RESET_TOKEN_MINUTOS, hashToken, esTokenValido, isMailerConfigured, solicitarResetPassword,
  emitirTokenVerificacion, enviarCorreoVerificacion, enviarAvisoCuentaExistente,
} = require('./lib/correosCuenta');

const router = Router();
const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
const ASSET_BASE = (process.env.SITE_URL || '').replace(/\/$/, '') || BASE;

// Los avatares viven en public/uploads/tribu/.
const DESTINO_AVATAR = 'tribu';
const uploadAvatar = crearUploadImagen({ limiteBytes: 3 * 1024 * 1024 });

function deleteFotoFile(fotoUrl) {
  borrarImagen(fotoUrl, DESTINO_AVATAR);
}

async function fetchUserPublic(id) {
  const [rows] = await pool.execute(
    'SELECT id, nombre, apellido, email, telefono, foto_url, carrera, hobbies, a_que_te_dedicas, intereses, objetivos, ciudad, onboarding_completado, como_empezar, psw_temp, is_suscribed, email_verificado FROM tribu_users WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) return null;
  const user = rows[0];
  await sincronizarIsSuscribed(id);
  const [sus] = await pool.execute(
    `SELECT ts.id, s.nombre, s.precio, ts.fecha_inicio, ts.fecha_fin, ts.es_prueba
      FROM tribu_suscripciones ts
      JOIN suscripciones s ON s.id = ts.suscripcion_id
      WHERE ts.tribu_user_id = ? AND ${accesoVigenteSql('ts')}
      ORDER BY ts.fecha_fin DESC LIMIT 1`,
    [id]
  );
  user.suscripcion_activa = sus.length > 0
    ? {
      nombre: sus[0].nombre,
      precio: sus[0].precio,
      fecha_inicio: toYmd(sus[0].fecha_inicio),
      fecha_fin: toYmd(sus[0].fecha_fin),
      es_prueba: !!sus[0].es_prueba,
    }
    : null;
  user.psw_temp = !!user.psw_temp;
  user.is_suscribed = !!user.suscripcion_activa;
  return user;
}

function userPayload(user) {
  // MySQL JSON columns pueden venir como strings; parsear si es string válido
  const parseJSON = (val) => {
    if (!val) return null;
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val); } catch { return null; }
  };
  return {
    id: user.id, nombre: user.nombre, apellido: user.apellido,
    email: user.email, telefono: user.telefono || null,
    foto_url: user.foto_url || null, psw_temp: !!user.psw_temp,
    is_suscribed: !!user.is_suscribed, suscripcion_activa: user.suscripcion_activa || null,
    carrera: user.carrera || null,
    hobbies: user.hobbies || null,
    a_que_te_dedicas: user.a_que_te_dedicas || null,
    intereses: parseJSON(user.intereses),
    objetivos: parseJSON(user.objetivos),
    ciudad: user.ciudad || null,
    onboarding_completado: !!user.onboarding_completado,
    como_empezar: user.como_empezar || null,
    email_verificado: user.email_verificado == null ? true : !!user.email_verificado,
  };
}

async function issueSessionForUserId(userId) {
  const profile = await fetchUserPublic(userId);
  if (!profile) return null;
  return { token: signToken(profile), user: userPayload(profile) };
}

const TRIBU_JWT_SECRET = JWT_SECRET + '_tribu';

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
function attemptKey(ip, email) { return ip + '\x00' + email; }
function getAttempts(key) {
  const r = loginAttempts.get(key);
  if (!r || Date.now() - r.start > WINDOW_MS) return null;
  return r;
}
function recordAttempt(key) {
  const r = loginAttempts.get(key);
  if (!r || Date.now() - r.start > WINDOW_MS) loginAttempts.set(key, { count: 1, start: Date.now() });
  else r.count++;
}
function resetAttempts(key) { loginAttempts.delete(key); }
const loginAttemptsCleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, r] of loginAttempts) if (now - r.start > WINDOW_MS) loginAttempts.delete(k);
}, 30 * 60 * 1000);
loginAttemptsCleanup.unref();

function stopLoginAttemptsCleanup() { clearInterval(loginAttemptsCleanup); }
process.on('SIGTERM', stopLoginAttemptsCleanup);
process.on('SIGINT', stopLoginAttemptsCleanup);

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

router.post('/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const key = attemptKey(ip, email.trim().toLowerCase());
    const record = getAttempts(key);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta en ${remaining} minuto(s).` });
    }

    const [rows] = await pool.execute(
      'SELECT id, nombre, apellido, email, password, psw_temp, is_suscribed FROM tribu_users WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if (!rows.length) { recordAttempt(key); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordAttempt(key); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    resetAttempts(key);
    const token = signToken(user);
    const profile = await fetchUserPublic(user.id);
    res.json({ token, user: userPayload(profile || user) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error en el login' }); }
});

const HORA_MS = 60 * 60 * 1000;
const limiteRegistroIp = crearLimitador({ max: 5, ventanaMs: HORA_MS });
const limiteRecuperarIp = crearLimitador({ max: 10, ventanaMs: HORA_MS });
const limiteRecuperarEmail = crearLimitador({ max: 3, ventanaMs: HORA_MS });
const limiteResetIp = crearLimitador({ max: 10, ventanaMs: HORA_MS });
const limiteReenvioVerificacion = crearLimitador({ max: 3, ventanaMs: HORA_MS });

const MSG_REGISTRO_PENDIENTE = 'Si el correo no estaba registrado, te enviamos un enlace para confirmar tu cuenta. Si ya tienes cuenta, inicia sesión o usa «Olvidé mi contraseña».';
const MSG_REGISTRO_NO_DISPONIBLE = 'No pudimos crear la cuenta con ese correo. Si ya tienes cuenta, inicia sesión o usa «Olvidé mi contraseña».';
const MSG_RECUPERAR = `Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa tu bandeja de entrada y spam. El enlace vence en ${RESET_TOKEN_MINUTOS} minutos.`;

function emailValido(emailNorm) {
  return emailNorm.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm);
}

router.post('/registro', async (req, res) => {
  try {
    const rl = limiteRegistroIp.consumir(ipDe(req));
    if (!rl.ok) return responder429(res, rl);
    const { nombre, apellido, email, password } = req.body || {};
    if (!nombre || !apellido || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (String(password).length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const emailNorm = String(email).trim().toLowerCase();
    if (!emailValido(emailNorm)) return res.status(400).json({ error: 'Correo electrónico inválido' });
    const nombreLimpio = String(nombre).trim().slice(0, 120);
    const apellidoLimpio = String(apellido).trim().slice(0, 120);
    const verificar = isMailerConfigured();
    const hash = await bcrypt.hash(String(password), 12);

    const respuestaExistente = (nombreExistente) => {
      if (verificar) {
        enviarAvisoCuentaExistente({ email: emailNorm, nombre: nombreExistente });
        return res.status(202).json({ verificacion_pendiente: true, message: MSG_REGISTRO_PENDIENTE });
      }
      return res.status(409).json({ error: MSG_REGISTRO_NO_DISPONIBLE });
    };

    const [existe] = await pool.execute('SELECT id, nombre FROM tribu_users WHERE email = ? LIMIT 1', [emailNorm]);
    if (existe.length) return respuestaExistente(existe[0].nombre);

    let result;
    try {
      [result] = await pool.execute(
        `INSERT INTO tribu_users (nombre, apellido, email, password, psw_temp, is_suscribed, estado, email_verificado)
          VALUES (?, ?, ?, ?, 0, 0, 'prospecto', ?)`,
        [nombreLimpio, apellidoLimpio, emailNorm, hash, verificar ? 0 : 1]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return respuestaExistente(null);
      throw e;
    }

    if (verificar) {
      const token = await emitirTokenVerificacion(result.insertId);
      enviarCorreoVerificacion({ email: emailNorm, nombre: nombreLimpio, token });
      return res.status(202).json({ verificacion_pendiente: true, message: MSG_REGISTRO_PENDIENTE });
    }

    const user = { id: result.insertId, nombre: nombreLimpio, apellido: apellidoLimpio, email: emailNorm };
    const token = signToken(user);
    res.status(201).json({ token, user: { ...user, psw_temp: false, is_suscribed: false, email_verificado: true } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear la cuenta' }); }
});

router.get('/verificar-email', async (req, res) => {
  const token = String(req.query.token || '');
  let ok = false;
  try {
    if (esTokenValido(token)) {
      const [upd] = await pool.execute(
        `UPDATE tribu_users SET email_verificado = 1, verify_token = NULL, verify_token_exp = NULL
          WHERE verify_token = ? AND verify_token_exp > NOW()`,
        [hashToken(token)]
      );
      ok = (upd?.affectedRows || 0) > 0;
    }
  } catch (err) { console.error('[tribu-auth verificar-email]', err.message); }
  res.redirect(302, `${BASE}/camino?login=1&verificado=${ok ? '1' : '0'}`);
});

router.post('/reenviar-verificacion', tribuAuthMiddleware, async (req, res) => {
  const message = 'Si tu correo aún no está confirmado, te enviamos un nuevo enlace.';
  try {
    const rl = limiteReenvioVerificacion.consumir(String(req.tribuUser.id));
    if (!rl.ok) return responder429(res, rl);
    if (!isMailerConfigured()) return res.json({ message });
    const [[u]] = await pool.execute(
      'SELECT id, nombre, email, email_verificado FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]
    );
    if (u && !u.email_verificado) {
      const token = await emitirTokenVerificacion(u.id);
      enviarCorreoVerificacion({ email: u.email, nombre: u.nombre, token });
    }
    res.json({ message });
  } catch (err) { console.error('[tribu-auth reenviar-verificacion]', err.message); res.json({ message }); }
});

router.post('/recuperar', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email requerido' });
    const emailNorm = email.trim().toLowerCase();
    const rlIp = limiteRecuperarIp.consumir(ipDe(req));
    if (!rlIp.ok) return responder429(res, rlIp);
    if (!emailValido(emailNorm) || !limiteRecuperarEmail.consumir(emailNorm).ok) {
      return res.json({ message: MSG_RECUPERAR });
    }
    const [rows] = await pool.execute(
      'SELECT id, nombre, email FROM tribu_users WHERE email = ? LIMIT 1', [emailNorm]
    );
    if (rows.length) await solicitarResetPassword(rows[0]);
    res.json({ message: MSG_RECUPERAR });
  } catch (err) {
    console.error('[tribu-auth recuperar]', err.message);
    res.json({ message: MSG_RECUPERAR });
  }
});

router.post('/definir-contrasena', tribuAuthMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const [[row]] = await pool.execute(
      'SELECT id, psw_temp FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]
    );
    if (!row) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!row.psw_temp) return res.status(400).json({ error: 'Tu cuenta ya tiene contraseña definida' });
    const hash = await bcrypt.hash(String(newPassword), 12);
    await pool.execute(
      'UPDATE tribu_users SET password = ?, psw_temp = 0 WHERE id = ?',
      [hash, row.id]
    );
    const session = await issueSessionForUserId(row.id);
    res.json({ message: 'Contraseña creada', ...session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la contraseña' });
  }
});

router.put('/onboarding', tribuAuthMiddleware, async (req, res) => {
  try {
    const {
      nombre, apellido, ciudad, carrera, intereses, objetivos, como_empezar, completado,
    } = req.body;
    const sets = [];
    const params = [];
    if (nombre) { sets.push('nombre = ?'); params.push(sanitizeName(nombre)); }
    if (apellido) { sets.push('apellido = ?'); params.push(sanitizeName(apellido)); }
    if (ciudad !== undefined) { sets.push('ciudad = ?'); params.push(ciudad ? String(ciudad).trim().slice(0, 120) : null); }
    if (carrera !== undefined) { sets.push('carrera = ?'); params.push(carrera ? String(carrera).trim().slice(0, 200) : null); }
    if (Array.isArray(intereses)) {
      sets.push('intereses = ?');
      params.push(JSON.stringify(intereses.slice(0, 6)));
    }
    if (Array.isArray(objetivos)) {
      sets.push('objetivos = ?');
      params.push(JSON.stringify(objetivos.slice(0, 3)));
    }
    if (como_empezar !== undefined) {
      sets.push('como_empezar = ?');
      params.push(como_empezar ? String(como_empezar).trim().slice(0, 80) : null);
    }
    if (completado === true || completado === 1 || completado === '1') {
      sets.push('onboarding_completado = 1');
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.tribuUser.id);
    await pool.execute(`UPDATE tribu_users SET ${sets.join(', ')} WHERE id = ?`, params);
    const session = await issueSessionForUserId(req.tribuUser.id);
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar onboarding' });
  }
});

router.post('/cambiar-password-temp', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const { email, tempPassword, newPassword } = req.body;
    if (!email || !tempPassword || !newPassword)
      return res.status(400).json({ error: 'Correo, contraseña temporal y nueva contraseña son requeridos' });
    if (String(newPassword).length < 6)
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    const emailNorm = email.trim().toLowerCase();
    const key = attemptKey(ip, emailNorm);
    const record = getAttempts(key);
    if (record && record.count >= MAX_ATTEMPTS) {
      const remaining = Math.ceil((WINDOW_MS - (Date.now() - record.start)) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Intenta en ${remaining} minuto(s).` });
    }
    const [rows] = await pool.execute(
      'SELECT id, password FROM tribu_users WHERE email = ? AND psw_temp = 1 LIMIT 1', [emailNorm]
    );
    if (!rows.length) { recordAttempt(key); return res.status(400).json({ error: 'No se encontró una cuenta con contraseña temporal para ese correo' }); }

    const valid = await bcrypt.compare(String(tempPassword), rows[0].password);
    if (!valid) { recordAttempt(key); return res.status(401).json({ error: 'Contraseña temporal incorrecta' }); }

    resetAttempts(key);
    const hash = await bcrypt.hash(String(newPassword), 12);
    await pool.execute(
      'UPDATE tribu_users SET password = ?, psw_temp = 0, reset_token = NULL, reset_token_exp = NULL WHERE id = ?',
      [hash, rows[0].id]
    );
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar la contraseña' }); }
});

router.post('/reset-password', async (req, res) => {
  try {
    const rl = limiteResetIp.consumir(ipDe(req));
    if (!rl.ok) return responder429(res, rl);
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const invalido = () => res.status(400).json({ error: 'El enlace no es válido o ya venció. Solicita uno nuevo.' });
    if (!esTokenValido(String(token))) return invalido();

    const tokenHash = hashToken(String(token));
    const [rows] = await pool.execute(
      'SELECT id FROM tribu_users WHERE reset_token = ? AND reset_token_exp > NOW() LIMIT 1', [tokenHash]
    );
    if (!rows.length) return invalido();

    const hash = await bcrypt.hash(String(password), 12);
    const [upd] = await pool.execute(
      `UPDATE tribu_users SET password = ?, psw_temp = 0, email_verificado = 1, reset_token = NULL, reset_token_exp = NULL
        WHERE id = ? AND reset_token = ? AND reset_token_exp > NOW()`,
      [hash, rows[0].id, tokenHash]
    );
    if (!upd || !upd.affectedRows) return invalido();
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar la contraseña' }); }
});

router.get('/me', tribuAuthMiddleware, async (req, res) => {
  try {
    const user = await fetchUserPublic(req.tribuUser.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(userPayload(user));
  } catch (err) { res.status(500).json({ error: 'Error al obtener usuario' }); }
});

router.get('/facturacion', tribuAuthMiddleware, async (req, res) => {
  try {
    const [[profile]] = await pool.execute(
      'SELECT billing_email, identification_type, identification_number FROM tribu_payer_profiles WHERE tribu_user_id = ? LIMIT 1',
      [req.tribuUser.id]
    );
    const [[user]] = await pool.execute('SELECT email FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]);
    res.json({
      billing_email: profile?.billing_email || null,
      account_email: user?.email || null,
      identification_type: profile?.identification_type || null,
      identification_number: profile?.identification_number || null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener datos de facturación' }); }
});

router.put('/perfil', tribuAuthMiddleware, async (req, res) => {
  try {
    const nombre = sanitizeName(req.body.nombre) || null;
    const apellido = sanitizeName(req.body.apellido) || null;
    const email = sanitizeEmail(req.body.email);
    const telefono = sanitizePhone(req.body.telefono);
    const carrera = String(req.body.carrera || '').trim().slice(0, 200) || null;
    const hobbies = req.body.hobbies != null ? String(req.body.hobbies).slice(0, 65535) : null;
    const a_que_te_dedicas = req.body.a_que_te_dedicas != null ? String(req.body.a_que_te_dedicas).slice(0, 65535) : null;

    if (email) {
      const [[existing]] = await pool.execute(
        'SELECT id FROM tribu_users WHERE email = ? AND id != ? LIMIT 1', [email, req.tribuUser.id]
      );
      if (existing) return res.status(409).json({ error: 'Ese correo ya está en uso por otra cuenta' });
    }

    const updates = [];
    const params = [];
    if (nombre) { updates.push('nombre = ?'); params.push(nombre); }
    if (apellido) { updates.push('apellido = ?'); params.push(apellido); }
    if (email) { updates.push('email = ?'); params.push(email); }
    if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono); }
    updates.push('carrera = ?', 'hobbies = ?', 'a_que_te_dedicas = ?');
    params.push(carrera, hobbies, a_que_te_dedicas);
    if (Array.isArray(req.body.intereses)) {
      updates.push('intereses = ?');
      params.push(JSON.stringify(req.body.intereses.slice(0, 6)));
    }
    if (Array.isArray(req.body.objetivos)) {
      updates.push('objetivos = ?');
      params.push(JSON.stringify(req.body.objetivos.slice(0, 3)));
    }
    params.push(req.tribuUser.id);

    await pool.execute(`UPDATE tribu_users SET ${updates.join(', ')} WHERE id = ?`, params);
    const user = await fetchUserPublic(req.tribuUser.id);
    const token = signToken(user);
    res.json({ user: userPayload(user), token });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar el perfil' }); }
});

router.put('/perfil/comunidad', tribuAuthMiddleware, async (req, res) => {
  try {
    const { ciudad, intereses, objetivos } = req.body;
    const ciudadVal = ciudad != null ? String(ciudad).trim().slice(0, 120) || null : undefined;
    const interesesVal = Array.isArray(intereses) ? JSON.stringify(intereses.slice(0, 6)) : undefined;
    const objetivosVal = Array.isArray(objetivos) ? JSON.stringify(objetivos.slice(0, 3)) : undefined;
    const sets = [];
    const params = [];
    if (ciudadVal !== undefined) { sets.push('ciudad = ?'); params.push(ciudadVal); }
    if (interesesVal !== undefined) { sets.push('intereses = ?'); params.push(interesesVal); }
    if (objetivosVal !== undefined) { sets.push('objetivos = ?'); params.push(objetivosVal); }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.tribuUser.id);
    await pool.execute(`UPDATE tribu_users SET ${sets.join(', ')} WHERE id = ?`, params);
    const user = await fetchUserPublic(req.tribuUser.id);
    const token = signToken(user);
    res.json({ user: userPayload(user), token });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al guardar' }); }
});

router.post('/perfil/foto', tribuAuthMiddleware, (req, res) => {
  uploadAvatar.single('foto')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Archivo no válido' });
    if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen' });
    let guardada = null;
    try {
      const [rows] = await pool.execute('SELECT foto_url FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]);
      const oldUrl = rows[0]?.foto_url;
      guardada = await guardarImagen(req.file, {
        destino: DESTINO_AVATAR,
        prefijo: `avatar_${req.tribuUser.id}`,
        assetBase: ASSET_BASE,
      });
      const foto_url = guardada.url;
      await pool.execute('UPDATE tribu_users SET foto_url = ? WHERE id = ?', [foto_url, req.tribuUser.id]);
      // El avatar anterior se borra despues del UPDATE: si este falla, el
      // usuario sigue apuntando a una imagen que existe.
      if (oldUrl && oldUrl !== foto_url) deleteFotoFile(oldUrl);
      const user = await fetchUserPublic(req.tribuUser.id);
      res.json({ foto_url, user: userPayload(user) });
    } catch (e) {
      if (guardada) deleteFotoFile(guardada.url);
      if (e.status === 400) return res.status(400).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Error al subir la foto' });
    }
  });
});

router.delete('/perfil/foto', tribuAuthMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT foto_url FROM tribu_users WHERE id = ? LIMIT 1', [req.tribuUser.id]);
    await pool.execute('UPDATE tribu_users SET foto_url = NULL WHERE id = ?', [req.tribuUser.id]);
    if (rows[0]?.foto_url) deleteFotoFile(rows[0].foto_url);
    const user = await fetchUserPublic(req.tribuUser.id);
    res.json({ user: userPayload(user) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al quitar la foto' }); }
});

function cardLabelFromRow(brand, lastFour) {
  if (!brand && !lastFour) return null;
  const labels = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', diners: 'Diners' };
  const name = labels[String(brand || '').toLowerCase()] || brand || 'Tarjeta';
  return lastFour ? `${name} ···· ${lastFour}` : name;
}

router.get('/suscripciones', tribuAuthMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ts.id, ts.fecha_inicio, ts.fecha_fin, ts.activo, ts.auto_renovacion, ts.es_prueba,
              ts.culqi_card_id, ts.culqi_card_brand, ts.cancelada_at,
              s.nombre, s.precio, s.descripcion, s.vigencia_dias,
              ${accesoVigenteSql('ts')} AS vigente,
              sc.last_four_digits
        FROM tribu_suscripciones ts
        JOIN suscripciones s ON s.id = ts.suscripcion_id
        LEFT JOIN tribu_saved_cards sc
          ON sc.tribu_user_id = ts.tribu_user_id AND sc.culqi_card_id = ts.culqi_card_id AND sc.activo = 1
        WHERE ts.tribu_user_id = ?
        ORDER BY ts.fecha_inicio DESC`,
      [req.tribuUser.id]
    );
    const savedCards = await listSavedCards(req.tribuUser.id);
    const data = rows.map(r => {
      const vigente = !!r.vigente;
      const hasCard = !!r.culqi_card_id;
      const autoOn = !!(r.auto_renovacion && vigente && hasCard);
      return {
        id: r.id, nombre: r.nombre, precio: r.precio, descripcion: r.descripcion,
        vigencia_dias: r.vigencia_dias,
        fecha_inicio: toYmd(r.fecha_inicio), fecha_fin: toYmd(r.fecha_fin),
        activo: vigente, es_prueba: !!r.es_prueba, auto_renovacion: autoOn,
        tarjeta_label: cardLabelFromRow(r.culqi_card_brand, r.last_four_digits),
        puede_cancelar_autorenovacion: autoOn,
        puede_activar_autorenovacion: vigente && !autoOn && savedCards.length > 0,
        proxima_renovacion: autoOn ? toYmd(r.fecha_fin) : null,
        cancelada_at: r.cancelada_at ? toYmd(r.cancelada_at) : null,
      };
    });
    res.json({ data, tarjetas: savedCards });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener suscripciones' }); }
});

router.get('/tarjetas', tribuAuthMiddleware, async (req, res) => {
  try {
    const data = await listSavedCards(req.tribuUser.id);
    res.json({ data });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener tarjetas' }); }
});

router.delete('/tarjetas/:id', tribuAuthMiddleware, async (req, res) => {
  try {
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId)) return res.status(400).json({ error: 'Tarjeta inválida' });
    const ok = await deactivateSavedCard(req.tribuUser.id, cardId);
    if (!ok) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    res.json({ message: 'Tarjeta eliminada. La autorenovación asociada fue desactivada.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'No se pudo eliminar la tarjeta' }); }
});

router.put('/tarjetas/:id/default', tribuAuthMiddleware, async (req, res) => {
  try {
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId)) return res.status(400).json({ error: 'Tarjeta inválida' });
    const ok = await setDefaultCard(req.tribuUser.id, cardId);
    if (!ok) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    res.json({ message: 'Tarjeta principal actualizada' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'No se pudo actualizar la tarjeta' }); }
});

router.put('/suscripciones/:id/auto-renovacion', tribuAuthMiddleware, async (req, res) => {
  try {
    const subId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(subId)) return res.status(400).json({ error: 'Suscripción inválida' });

    const enabled = req.body.enabled !== false && req.body.enabled !== 0 && req.body.enabled !== '0';
    const tarjetaId = req.body.tarjeta_id ? Number.parseInt(String(req.body.tarjeta_id), 10) : null;

    const [[sub]] = await pool.execute(
      `SELECT ts.id, ts.tribu_user_id, ts.culqi_card_id, ts.culqi_customer_id, ts.culqi_card_brand,
              ${accesoVigenteSql('ts')} AS vigente
       FROM tribu_suscripciones ts WHERE ts.id = ? AND ts.tribu_user_id = ? LIMIT 1`,
      [subId, req.tribuUser.id]
    );
    if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });
    if (!sub.vigente) return res.status(400).json({ error: 'La suscripción no está vigente' });

    if (!enabled) {
      await pool.execute('UPDATE tribu_suscripciones SET auto_renovacion = 0, cancelada_at = NOW() WHERE id = ?', [subId]);
      return res.json({ message: 'Autorenovación cancelada. Tu acceso sigue activo hasta la fecha de vencimiento.' });
    }

    let customerId = sub.culqi_customer_id, cardId = sub.culqi_card_id, cardBrand = sub.culqi_card_brand;
    if (tarjetaId) {
      const saved = await getSavedCard(req.tribuUser.id, tarjetaId);
      if (!saved) return res.status(400).json({ error: 'Tarjeta no encontrada' });
      customerId = saved.culqi_customer_id; cardId = saved.culqi_card_id; cardBrand = saved.culqi_card_brand;
    } else if (!cardId) {
      const fallback = await getDefaultSavedCard(req.tribuUser.id);
      if (!fallback) return res.status(400).json({ error: 'Para activar la autorenovación necesitas una tarjeta guardada.' });
      customerId = fallback.culqi_customer_id; cardId = fallback.culqi_card_id; cardBrand = fallback.culqi_card_brand;
    }

    await pool.execute(
      `UPDATE tribu_suscripciones SET auto_renovacion = 1, cancelada_at = NULL,
       renovacion_intentos = 0, next_renovacion_intento = NULL,
       culqi_customer_id = ?, culqi_card_id = ?, culqi_card_brand = ? WHERE id = ?`,
      [String(customerId), String(cardId), cardBrand, subId]
    );
    res.json({ message: 'Autorenovación activada.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'No se pudo actualizar la autorenovación' }); }
});

module.exports = { router, tribuAuthMiddleware, TRIBU_JWT_SECRET, issueSessionForUserId, userPayload, fetchUserPublic };