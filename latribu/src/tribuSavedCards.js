/**
 * Tarjetas guardadas en Culqi (Customer/Card API) para autorenovación La Tribu.
 */
const pool = require('./db');

const BRAND_LABELS = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  diners: 'Diners',
};

function formatCardPublic(row) {
  const brandKey = String(row.culqi_card_brand || 'tarjeta').toLowerCase();
  const brand = BRAND_LABELS[brandKey] || String(row.culqi_card_brand || 'Tarjeta');
  const last4 = row.last_four_digits || '????';
  return {
    id: row.id,
    brand: row.culqi_card_brand,
    last_four: row.last_four_digits,
    exp_month: row.exp_month,
    exp_year: row.exp_year,
    label: `${brand} ···· ${last4}`,
    is_default: !!row.is_default,
  };
}

async function listSavedCards(userId) {
  const [rows] = await pool.execute(
    `SELECT id, culqi_customer_id, culqi_card_id, culqi_card_brand, last_four_digits,
            exp_month, exp_year, is_default
     FROM tribu_saved_cards
     WHERE tribu_user_id = ? AND activo = 1
     ORDER BY is_default DESC, id DESC`,
    [userId]
  );
  return rows.map(formatCardPublic);
}

async function getSavedCard(userId, cardRowId) {
  const [[row]] = await pool.execute(
    `SELECT id, culqi_customer_id, culqi_card_id, culqi_card_brand, last_four_digits,
            exp_month, exp_year, is_default
     FROM tribu_saved_cards
     WHERE tribu_user_id = ? AND id = ? AND activo = 1 LIMIT 1`,
    [userId, cardRowId]
  );
  return row || null;
}

async function getDefaultSavedCard(userId) {
  const [[row]] = await pool.execute(
    `SELECT id, culqi_customer_id, culqi_card_id, culqi_card_brand, last_four_digits,
            exp_month, exp_year, is_default
     FROM tribu_saved_cards
     WHERE tribu_user_id = ? AND activo = 1
     ORDER BY is_default DESC, id DESC LIMIT 1`,
    [userId]
  );
  return row || null;
}

async function upsertSavedCard(userId, vault) {
  const customerId = String(vault.customerId);
  const cardId = String(vault.cardId);
  await pool.execute(
    'UPDATE tribu_saved_cards SET is_default = 0 WHERE tribu_user_id = ?',
    [userId]
  );
  await pool.execute(
    `INSERT INTO tribu_saved_cards
      (tribu_user_id, culqi_customer_id, culqi_card_id, culqi_card_brand,
       last_four_digits, exp_month, exp_year, is_default, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE
       culqi_customer_id = VALUES(culqi_customer_id),
       culqi_card_brand = VALUES(culqi_card_brand),
       last_four_digits = VALUES(last_four_digits),
       exp_month = VALUES(exp_month),
       exp_year = VALUES(exp_year),
       is_default = 1,
       activo = 1`,
    [
      userId,
      customerId,
      cardId,
      vault.cardBrand || null,
      vault.lastFour || null,
      vault.expMonth || null,
      vault.expYear || null,
    ]
  );
  const [[saved]] = await pool.execute(
    'SELECT id FROM tribu_saved_cards WHERE tribu_user_id = ? AND culqi_card_id = ? LIMIT 1',
    [userId, cardId]
  );
  return saved?.id || null;
}

async function setDefaultCard(userId, cardRowId) {
  const card = await getSavedCard(userId, cardRowId);
  if (!card) return false;
  await pool.execute('UPDATE tribu_saved_cards SET is_default = 0 WHERE tribu_user_id = ?', [userId]);
  await pool.execute(
    'UPDATE tribu_saved_cards SET is_default = 1 WHERE tribu_user_id = ? AND id = ?',
    [userId, cardRowId]
  );
  return true;
}

async function deactivateSavedCard(userId, cardRowId) {
  const card = await getSavedCard(userId, cardRowId);
  if (!card) return false;
  await pool.execute(
    'UPDATE tribu_saved_cards SET activo = 0, is_default = 0 WHERE tribu_user_id = ? AND id = ?',
    [userId, cardRowId]
  );
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET auto_renovacion = 0
     WHERE tribu_user_id = ? AND activo = 1 AND culqi_card_id = ?`,
    [userId, card.culqi_card_id]
  );
  const [[next]] = await pool.execute(
    `SELECT id FROM tribu_saved_cards
     WHERE tribu_user_id = ? AND activo = 1
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  if (next) {
    await pool.execute(
      'UPDATE tribu_saved_cards SET is_default = 1 WHERE tribu_user_id = ? AND id = ?',
      [userId, next.id]
    );
  }
  return true;
}

module.exports = {
  formatCardPublic,
  listSavedCards,
  getSavedCard,
  getDefaultSavedCard,
  upsertSavedCard,
  setDefaultCard,
  deactivateSavedCard,
};
