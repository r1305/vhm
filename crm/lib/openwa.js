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

const DEFAULT_COUNTRY_CODE = process.env.WA_DEFAULT_COUNTRY_CODE || '51';

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';

  // JID de WhatsApp: extraer solo la parte numérica antes del @
  const jidPart = raw.includes('@') ? raw.split('@')[0] : raw;
  let digits = jidPart.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Perú: móvil de 9 dígitos que empieza en 9 → agregar código 51
  if (DEFAULT_COUNTRY_CODE === '51' && digits.length === 9 && digits.startsWith('9')) {
    digits = `51${digits}`;
  }
  return digits;
}

function toChatId(phoneOrJid) {
  const raw = String(phoneOrJid || '').trim();
  if (!raw) return null;
  if (raw.includes('@lid')) return raw;
  if (raw.includes('@')) return raw;
  const digits = normalizePhone(raw);
  return digits ? `${digits}@c.us` : null;
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
  return { ok: true, messageId: data.messageId, chatId: data.chatId || chatId };
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

async function searchMessagesByPhone(phone, sessionId) {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const sid = sessionId || process.env.OPENWA_SESSION;
  const params = new URLSearchParams({ phone: digits, limit: '200' });
  if (sid) params.set('sessionId', sid);
  return openwaFetch(`/api/chats/search/messages?${params}`);
}

async function getSessionMessages(sessionId, limit = 200) {
  const sid = sessionId || process.env.OPENWA_SESSION;
  if (!sid) return [];
  const params = new URLSearchParams({ limit: String(Math.min(limit, 300)) });
  return openwaFetch(`/api/sessions/${encodeURIComponent(sid)}/messages?${params}`);
}

async function resolveLidPhone(lidChatId) {
  const lid = String(lidChatId || '').trim();
  if (!lid.includes('@lid')) return null;
  try {
    const data = await openwaFetch(`/api/chats/lid/resolve?${new URLSearchParams({ lid })}`);
    return data?.phone ? normalizePhone(data.phone) : null;
  } catch (_) {
    return null;
  }
}

async function getSessionMessagesByPhone(phone, sessionId, limit = 300) {
  const digits = normalizePhone(phone);
  const sid = sessionId || process.env.OPENWA_SESSION;
  if (!digits || !sid) return [];
  const params = new URLSearchParams({ phone: digits, limit: String(Math.min(limit, 300)) });
  return openwaFetch(`/api/sessions/${encodeURIComponent(sid)}/messages?${params}`);
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
  searchMessagesByPhone,
  getSessionMessages,
  getSessionMessagesByPhone,
  resolveLidPhone,
};
