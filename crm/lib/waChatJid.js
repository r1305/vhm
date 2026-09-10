/**
 * Resolución de JID para conversaciones del inbox CRM (LID vs s.whatsapp.net).
 * El cron/broadcast delega la resolución a OpenWA (onWhatsApp + lid_map).
 */

const { normalizePhone, toChatId } = require('./openwa');

function normalizeChatId(chatId) {
  const raw = String(chatId || '').trim();
  if (!raw) return null;
  if (raw.includes('@lid')) return raw;
  if (raw.includes('@g.us')) return raw;
  const phone = normalizePhone(raw.split('@')[0]);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

function isWhatsAppPhone(digits) {
  const d = normalizePhone(digits);
  return d.length >= 10 && d.length <= 13;
}

function phoneTail(phone) {
  const digits = normalizePhone(phone);
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function resolveChatJidForConv(conv) {
  if (!conv) return null;
  return conv.lid_chat_id
    || (conv.chat_id?.includes('@lid') ? conv.chat_id : null)
    || (isWhatsAppPhone(conv.phone) ? (normalizeChatId(conv.chat_id) || toChatId(conv.phone)) : null)
    || conv.chat_id
    || toChatId(conv.phone);
}

module.exports = {
  normalizeChatId,
  isWhatsAppPhone,
  phoneTail,
  resolveChatJidForConv,
};
