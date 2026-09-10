/**
 * WhatsApp via openwa-cpanel (Baileys)
 * Mantiene compatibilidad con cron e integraciones existentes.
 */

const { loadOpenwaConfigFromDB, isOpenwaConfigured, sendWhatsApp } = require('./openwa');

async function sendWhatsAppGreen({ to, message }) {
  await loadOpenwaConfigFromDB();
  if (!isOpenwaConfigured()) {
    console.log('[crm/openwa] No configurado — omitido:', to);
    return { skipped: true };
  }
  try {
    // OpenWA resuelve LID vía onWhatsApp al enviar (no requiere chat previo en CRM)
    const result = await sendWhatsApp({ to, message });
    return { ok: true, messageId: result.messageId, chatId: result.chatId || null };
  } catch (err) {
    throw err;
  }
}

module.exports = { sendWhatsAppGreen, loadOpenwaConfigFromDB, isOpenwaConfigured };
