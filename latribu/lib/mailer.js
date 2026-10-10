const crypto = require('crypto');
const nodemailer = require('nodemailer');

const CONFIG_TTL_MS = 10 * 60 * 1000;
const REINTENTO_TRAS_FALLO_MS = 60 * 1000;
const FROM_POR_DEFECTO = 'La Tribu VHM <noreply@vhm.com.pe>';
const EMAIL_CONFIG_DB_POR_DEFECTO = 'ssfdgwtm_vhm';
const TIMEOUTS_SMTP = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };

const depsPorDefecto = {
  getPool: () => require('../src/db'),
  createTransport: (opts) => nodemailer.createTransport(opts),
  ahora: () => Date.now(),
};

let deps = { ...depsPorDefecto };
let cache = null;
let cargando = null;
let transporter = null;
let transporterClave = null;
let avisoSinSmtp = false;
let avisoRespaldoEnv = false;

function nombreBdConfigEmail() {
  const nombre = String(process.env.EMAIL_CONFIG_DB_NAME || EMAIL_CONFIG_DB_POR_DEFECTO).trim();
  if (!/^[A-Za-z0-9_]+$/.test(nombre)) {
    const err = new Error('EMAIL_CONFIG_DB_NAME inválido');
    err.code = 'EMAIL_CONFIG_DB_NAME_INVALIDO';
    throw err;
  }
  return nombre;
}

function limpiarNombre(s) {
  return String(s == null ? '' : s).replace(/["\r\n<>]/g, '').trim();
}

function limpiarEmail(s) {
  return String(s == null ? '' : s).replace(/[\s"<>]/g, '');
}

function configDesdeFila(row) {
  if (!row) throw Object.assign(new Error('config_email sin fila id=1'), { code: 'CONFIG_EMAIL_SIN_FILA' });
  const host = String(row.smtp_host || '').trim();
  const user = String(row.smtp_user || '').trim();
  const pass = row.smtp_pass == null ? '' : String(row.smtp_pass);
  if (!host || !user || !pass) throw Object.assign(new Error('config_email incompleta'), { code: 'CONFIG_EMAIL_INCOMPLETA' });
  const email = limpiarEmail(row.email_from) || limpiarEmail(user);
  const nombre = limpiarNombre(row.nombre_from);
  return {
    host,
    port: parseInt(row.smtp_port, 10) || 587,
    secure: Number(row.smtp_secure) === 1 || row.smtp_secure === true,
    user,
    pass,
    from: nombre ? `"${nombre}" <${email}>` : email,
  };
}

function configDesdeEnv() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
    user,
    pass,
    from: process.env.SMTP_FROM || FROM_POR_DEFECTO,
  };
}

async function leerConfigEmailDb() {
  const bd = nombreBdConfigEmail();
  const [rows] = await deps.getPool().query(
    `SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, email_from, nombre_from FROM \`${bd}\`.config_email WHERE id = 1 LIMIT 1`
  );
  return configDesdeFila(rows && rows[0]);
}

async function cargarConfig() {
  const ahora = deps.ahora();
  try {
    const cfg = await leerConfigEmailDb();
    cache = { cfg, origen: 'db', expira: ahora + CONFIG_TTL_MS };
    avisoRespaldoEnv = false;
    return cfg;
  } catch (err) {
    const motivo = err.code || 'error';
    if (cache && cache.origen === 'db' && cache.cfg) {
      console.warn(`[latribu/mail] No se pudo leer config_email (${motivo}); se mantiene la última configuración cargada`);
      cache = { cfg: cache.cfg, origen: 'db', expira: ahora + REINTENTO_TRAS_FALLO_MS };
      return cache.cfg;
    }
    const cfg = configDesdeEnv();
    if (!avisoRespaldoEnv) {
      console.warn(`[latribu/mail] No se pudo leer config_email (${motivo}); ${cfg ? 'se usan las variables SMTP_* como respaldo' : 'no hay SMTP_* de respaldo'}`);
      avisoRespaldoEnv = true;
    }
    cache = { cfg, origen: 'env', expira: ahora + REINTENTO_TRAS_FALLO_MS };
    return cfg;
  }
}

function obtenerConfig() {
  if (cache && deps.ahora() < cache.expira) return Promise.resolve(cache.cfg);
  if (!cargando) cargando = cargarConfig().finally(() => { cargando = null; });
  return cargando;
}

function claveConfig(cfg) {
  const hashPass = crypto.createHash('sha256').update(String(cfg.pass)).digest('hex');
  return [cfg.host, cfg.port, cfg.secure ? 1 : 0, cfg.user, hashPass].join('|');
}

function cerrarTransporter() {
  if (transporter) {
    try { transporter.close(); } catch (_) {}
  }
  transporter = null;
  transporterClave = null;
}

function transporterPara(cfg) {
  const clave = claveConfig(cfg);
  if (transporter && transporterClave === clave) return transporter;
  cerrarTransporter();
  transporter = deps.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    ...TIMEOUTS_SMTP,
  });
  transporterClave = clave;
  return transporter;
}

async function isMailerConfigured() {
  try {
    return !!(await obtenerConfig());
  } catch (_) {
    return false;
  }
}

async function sendMail({ to, subject, html, text }) {
  const cfg = await obtenerConfig();
  if (!cfg) {
    if (!avisoSinSmtp) {
      console.warn('[latribu/mail] SMTP no configurado (config_email ni SMTP_HOST/SMTP_USER/SMTP_PASS): no se envían correos');
      avisoSinSmtp = true;
    }
    return { skipped: true };
  }
  await transporterPara(cfg).sendMail({
    from: cfg.from,
    to,
    subject: String(subject).slice(0, 200),
    text: text || '',
    html: html || undefined,
  });
  return { ok: true };
}

function closeMailer() {
  cerrarTransporter();
}

function _resetForTests(nuevasDeps = {}) {
  cerrarTransporter();
  deps = { ...depsPorDefecto, ...nuevasDeps };
  cache = null;
  cargando = null;
  avisoSinSmtp = false;
  avisoRespaldoEnv = false;
}

module.exports = {
  sendMail,
  isMailerConfigured,
  closeMailer,
  _resetForTests,
  _internals: { obtenerConfig, nombreBdConfigEmail, configDesdeFila, CONFIG_TTL_MS, REINTENTO_TRAS_FALLO_MS },
};
