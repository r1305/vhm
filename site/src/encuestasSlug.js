const crypto = require('crypto');
const pool = require('./db');

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 10;
const SLUG_PATTERN = /^[a-z0-9]{10}$/;
const PROTECTED_SLUGS = new Set([
  'como-te-ha-ido-en-tus-sesiones-con-la-ps-pamela',
]);

function randomSlug() {
  let result = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    result += SLUG_CHARS[crypto.randomInt(SLUG_CHARS.length)];
  }
  return result;
}

function isModernSlug(slug) {
  return SLUG_PATTERN.test(String(slug || ''));
}

async function uniqueSlug() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const slug = randomSlug();
    const [rows] = await pool.execute('SELECT id FROM encuestas WHERE slug = ? LIMIT 1', [slug]);
    if (!rows.length) return slug;
  }
  return crypto.randomBytes(8).toString('hex').slice(0, SLUG_LENGTH);
}

function shouldAutoMigrateSlug(slug) {
  if (PROTECTED_SLUGS.has(slug)) return false;
  return !isModernSlug(slug);
}

async function applySlugFixes() {
  await pool.execute(
    'UPDATE encuestas SET slug = ? WHERE slug = ?',
    ['como-te-ha-ido-en-tus-sesiones-con-la-ps-pamela', 'rk2x5u7oqh']
  );
}

async function migrateLegacySlugs() {
  await applySlugFixes();
  const [rows] = await pool.execute('SELECT id, slug FROM encuestas');
  for (const row of rows) {
    if (!shouldAutoMigrateSlug(row.slug)) continue;
    const slug = await uniqueSlug();
    await pool.execute('UPDATE encuestas SET slug = ? WHERE id = ?', [slug, row.id]);
  }
}

module.exports = {
  SLUG_LENGTH,
  isModernSlug,
  uniqueSlug,
  migrateLegacySlugs,
};
