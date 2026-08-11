/**
 * WhatsApp via openwa-cpanel (Baileys, 100% gratuito)
 *
 * Variables de entorno (configurables desde panel Integraciones del CRM):
 *   OPENWA_URL        URL base de openwa, ej: https://vhm.com.pe/openwa
 *   OPENWA_API_KEY    API key de openwa (la que ves en el dashboard)
 *   OPENWA_SESSION    Session ID de la sesión activa en openwa
 */

async function sendWhatsAppGreen({ to, message }) {
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

module.exports = { sendWhatsAppGreen };
