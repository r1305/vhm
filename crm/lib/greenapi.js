/**
 * WhatsApp via openwa-cpanel (Baileys)
 *
 * Variables (panel Integraciones o .env):
 *   OPENWA_URL, OPENWA_API_KEY, OPENWA_SESSION
 */

async function loadOpenwaConfigFromDB() {
  const pool = require('./db');
  const [rows] = await pool.execute(
    "SELECT clave, valor FROM configuracion WHERE clave IN ('openwa_url','openwa_api_key','openwa_session')"
  );
  for (const r of rows) {
    if (!r.valor) continue;
    if (r.clave === 'openwa_url')     process.env.OPENWA_URL     = r.valor;
    if (r.clave === 'openwa_api_key') process.env.OPENWA_API_KEY = r.valor;
    if (r.clave === 'openwa_session') process.env.OPENWA_SESSION = r.valor;
  }
}

function isOpenwaConfigured() {
  return Boolean(
    process.env.OPENWA_URL &&
    process.env.OPENWA_API_KEY &&
    process.env.OPENWA_SESSION
  );
}

async function sendWhatsAppGreen({ to, message }) {
  await loadOpenwaConfigFromDB();

  const baseUrl   = (process.env.OPENWA_URL   || '').replace(/\/$/, '');
  const apiKey    = process.env.OPENWA_API_KEY || '';
  const sessionId = process.env.OPENWA_SESSION || '';

  if (!baseUrl || !apiKey || !sessionId) {
    console.log('[crm/openwa] No configurado — omitido:', to);
    return { skipped: true };
  }

  const chatId = to.replace(/\D/g, '') + '@c.us';

  const res = await fetch(`${baseUrl}/api/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ sessionId, chatId, message }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenWA error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => ({}));
  return { ok: true, messageId: data.messageId };
}

module.exports = { sendWhatsAppGreen, loadOpenwaConfigFromDB, isOpenwaConfigured };
