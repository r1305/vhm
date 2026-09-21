const crypto = require('crypto');
const pool = require('./db');

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 10;

function randomSlug() {
  let result = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    result += SLUG_CHARS[crypto.randomInt(SLUG_CHARS.length)];
  }
  return result;
}

async function uniqueSlug() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const slug = randomSlug();
    const [rows] = await pool.execute('SELECT id FROM crm_encuestas WHERE slug = ? LIMIT 1', [slug]);
    if (!rows.length) return slug;
  }
  return crypto.randomBytes(8).toString('hex').slice(0, SLUG_LENGTH);
}

module.exports = { uniqueSlug };
