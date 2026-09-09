/**
 * Cliente OpenWA para el CRM (envío, lectura de chats, historial).
 * Variables: OPENWA_URL, OPENWA_API_KEY, OPENWA_SESSION
 */

const pool = require('./db');

async function loadOpenwaConfigFromDB() {
  const [rows] = await pool.execute(
    "SELECT clave, valor FROM configuracion WHERE clave IN ('openwa_url','openwa_api_key','openwa_session','openwa_webhook_token')"
  );
  for (const r of rows) {
    if (!r.valor) continue;
    if (r.clave === 'openwa_url')            process.env.OPENWA_URL            = r.valor;
    if (r.clave === 'openwa_api_key')        process.env.OPENWA_API_KEY        = r.valor;
    if (r.clave === 'openwa_session')        process.env.OPENWA_SESSION        = r.valor;
    if (r.clave === 'openwa_webhook_token')  process.env.OPENWA_WEBHOOK_TOKEN  = r.valor;
  }
}

function isOpenwaConfigured() {
  return Boolean(
    process.env.OPENWA_URL &&
    process.env.OPENWA_API_KEY &&
    process.env.OPENWA_SESSION
  );
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function toChatId(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return digits.includes('@') ? digits : `${digits}@c.us`;
}

async function openwaFetch(path, options = {}) {
  await loadOpenwaConfigFromDB();
  const baseUrl = (process.env.OPENWA_URL || '').replace(/\/$/, '');
  const apiKey  = process.env.OPENWA_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('OpenWA no configurado');

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenWA ${res.status}: ${txt.slice(0, 200)}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

async function sendWhatsApp({ to, message }) {
  await loadOpenwaConfigFromDB();
  const sessionId = process.env.OPENWA_SESSION || '';
  const chatId = toChatId(to);
  if (!sessionId || !chatId) throw new Error('OpenWA no configurado');

  const data = await openwaFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({ sessionId, chatId, message }),
  });
  return { ok: true, messageId: data.messageId, chatId };
}

async function getChats(sessionId) {
  const sid = sessionId || process.env.OPENWA_SESSION;
  const qs = sid ? `?sessionId=${encodeURIComponent(sid)}` : '';
  return openwaFetch(`/api/chats${qs}`);
}

async function getChatMessages(chatId, sessionId) {
  const sid = sessionId || process.env.OPENWA_SESSION;
  const qs = sid ? `?sessionId=${encodeURIComponent(sid)}` : '';
  return openwaFetch(`/api/chats/${encodeURIComponent(chatId)}/messages${qs}`);
}

module.exports = {
  loadOpenwaConfigFromDB,
  isOpenwaConfigured,
  normalizePhone,
  toChatId,
  openwaFetch,
  sendWhatsApp,
  getChats,
  getChatMessages,
};
