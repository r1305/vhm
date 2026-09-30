const crypto = require('crypto');

/**
 * Sanitize a name string
 * @param {string} str - Input string
 * @param {number} max - Maximum length (default: 120)
 * @returns {string} Sanitized string
 */
function sanitizeName(str, max = 120) {
  return String(str || '').trim().slice(0, max);
}

/**
 * Sanitize a phone number
 * @param {string} str - Input string
 * @returns {string|null} Sanitized phone number or null if empty
 */
function sanitizePhone(str) {
  const cleaned = String(str || '').replace(/[^\d+]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Sanitize and validate an email
 * @param {string} str - Input string
 * @returns {string|null} Valid email or null if invalid
 */
function sanitizeEmail(str) {
  const e = String(str || '').trim().toLowerCase().slice(0, 150);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Convert value to YYYY-MM-DD format
 * @param {*} val - Date value
 * @returns {string|null} Date in YYYY-MM-DD format or null
 */
function toYmd(val) {
  if (val == null) return null;
  if (val instanceof Date) {
    return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
  }
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(val);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
  }
  return s.slice(0, 10);
}

/**
 * Generate a random hex string
 * @param {number} bytes - Number of random bytes (default: 16)
 * @returns {string} Random hex string
 */
function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  sanitizeName,
  sanitizePhone,
  sanitizeEmail,
  toYmd,
  randomHex
};