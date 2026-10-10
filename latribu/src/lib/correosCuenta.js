const crypto = require('crypto');
const pool = require('../db');
const { sendMail, isMailerConfigured } = require('../../lib/mailer');

const RESET_TOKEN_MINUTOS = 60;
const VERIFY_TOKEN_HORAS = 48;

function generarToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function esTokenValido(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
}

function siteUrl() {
  const raw = (process.env.SITE_URL || '').replace(/\/$/, '');
  return /^https?:\/\//i.test(raw) ? raw : '';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function plantilla(titulo, saludo, cuerpoHtml, boton) {
  const btn = boton
    ? `<p style="margin:24px 0"><a href="${esc(boton.url)}" style="background:#A84F3E;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${esc(boton.texto)}</a></p>
       <p style="font-size:12px;color:#6b7280">Si el botón no funciona, copia este enlace en tu navegador:<br>${esc(boton.url)}</p>`
    : '';
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;color:#2b1d19">
    <h2 style="font-family:Fraunces,Georgia,serif;color:#A84F3E">${esc(titulo)}</h2>
    <p>${esc(saludo)}</p>
    ${cuerpoHtml}
    ${btn}
    <p style="font-size:12px;color:#6b7280;margin-top:28px">La Tribu · VHM</p>
  </div>`;
}

async function enviarSeguro(fn, etiqueta) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[latribu/mail] ${etiqueta}:`, err.message);
    return { error: true };
  }
}

function enviarCorreoReset({ email, nombre, token }) {
  const base = siteUrl();
  if (!base) {
    console.warn('[latribu/mail] SITE_URL no configurado: no se puede generar el enlace de restablecimiento');
    return Promise.resolve({ skipped: true });
  }
  const url = `${base}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
  const saludo = `Hola${nombre ? ' ' + nombre : ''},`;
  return enviarSeguro(() => sendMail({
    to: email,
    subject: 'Restablece tu contraseña de La Tribu',
    text: `${saludo}\n\nRecibimos una solicitud para restablecer tu contraseña. Abre este enlace (válido ${RESET_TOKEN_MINUTOS} minutos, un solo uso):\n${url}\n\nSi no fuiste tú, ignora este correo.`,
    html: plantilla('Restablece tu contraseña', saludo,
      `<p>Recibimos una solicitud para restablecer tu contraseña. El enlace es válido durante ${RESET_TOKEN_MINUTOS} minutos y solo puede usarse una vez.</p>
       <p>Si no fuiste tú, ignora este correo: tu contraseña no cambiará.</p>`,
      { url, texto: 'Crear nueva contraseña' }),
  }), 'reset');
}

function enviarCorreoVerificacion({ email, nombre, token }) {
  const base = siteUrl();
  if (!base) {
    console.warn('[latribu/mail] SITE_URL no configurado: no se puede generar el enlace de verificación');
    return Promise.resolve({ skipped: true });
  }
  const url = `${base}/api/tribu-auth/verificar-email?token=${encodeURIComponent(token)}`;
  const saludo = `Hola${nombre ? ' ' + nombre : ''},`;
  return enviarSeguro(() => sendMail({
    to: email,
    subject: 'Confirma tu correo en La Tribu',
    text: `${saludo}\n\nConfirma tu correo para activar tu cuenta:\n${url}\n\nSi no creaste una cuenta, ignora este correo.`,
    html: plantilla('Confirma tu correo', saludo,
      '<p>Para activar tu cuenta de La Tribu confirma que este correo es tuyo.</p><p>Si no creaste una cuenta, ignora este mensaje.</p>',
      { url, texto: 'Confirmar mi correo' }),
  }), 'verificacion');
}

function enviarAvisoCuentaExistente({ email, nombre }) {
  const base = siteUrl();
  const saludo = `Hola${nombre ? ' ' + nombre : ''},`;
  const loginUrl = base ? `${base}/camino?login=1` : '';
  return enviarSeguro(() => sendMail({
    to: email,
    subject: 'Ya tienes una cuenta en La Tribu',
    text: `${saludo}\n\nAlguien intentó crear una cuenta con este correo, pero ya tienes una. Inicia sesión${loginUrl ? ' en ' + loginUrl : ''} o usa "Olvidé mi contraseña".\n\nSi no fuiste tú, ignora este correo.`,
    html: plantilla('Ya tienes una cuenta', saludo,
      '<p>Alguien intentó crear una cuenta con este correo, pero ya tienes una. Inicia sesión o usa «Olvidé mi contraseña» si no la recuerdas.</p><p>Si no fuiste tú, ignora este correo.</p>',
      loginUrl ? { url: loginUrl, texto: 'Iniciar sesión' } : null),
  }), 'aviso cuenta existente');
}

async function solicitarResetPassword(user, { esperarEnvio = false } = {}) {
  const { token, hash } = generarToken();
  await pool.execute(
    'UPDATE tribu_users SET reset_token = ?, reset_token_exp = NOW() + INTERVAL ? MINUTE WHERE id = ?',
    [hash, RESET_TOKEN_MINUTOS, user.id]
  );
  const envio = enviarCorreoReset({ email: user.email, nombre: user.nombre, token });
  if (!esperarEnvio) return { programado: true };
  const r = await envio;
  return { enviado: !!(r && r.ok) };
}

async function emitirTokenVerificacion(userId) {
  const { token, hash } = generarToken();
  await pool.execute(
    'UPDATE tribu_users SET verify_token = ?, verify_token_exp = NOW() + INTERVAL ? HOUR WHERE id = ?',
    [hash, VERIFY_TOKEN_HORAS, userId]
  );
  return token;
}

module.exports = {
  solicitarResetPassword,
  emitirTokenVerificacion,
  RESET_TOKEN_MINUTOS,
  VERIFY_TOKEN_HORAS,
  generarToken,
  hashToken,
  esTokenValido,
  isMailerConfigured,
  enviarCorreoReset,
  enviarCorreoVerificacion,
  enviarAvisoCuentaExistente,
};
