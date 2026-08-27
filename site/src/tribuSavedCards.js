/**
 * Tarjetas guardadas de usuarios La Tribu (referencias Culqi Customer/Card API).
 */
const pool = require('./db');

function formatCardPublic(row) {
  const brand = String(row.culqi_card_brand || 'tarjeta').toUpperCase();
  const last4 = row.last_four_digits || '????';
  return {
    id: row.id,
    brand: row.culqi_card_brand,
    last_four: row.last_four_digits,
    exp_month: row.exp_month,
    exp_year: row.exp_year,
    label: `${brand} ****${last4}`,
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

async function getSavedCardForUser(userId, cardRowId) {
  const [[row]] = await pool.execute(
    `SELECT id, tribu_user_id, culqi_customer_id, culqi_card_id, culqi_card_brand,
            last_four_digits, exp_month, exp_year, is_default
     FROM tribu_saved_cards
     WHERE id = ? AND tribu_user_id = ? AND activo = 1 LIMIT 1`,
    [cardRowId, userId]
  );
  return row || null;
}

async function upsertSavedCard(userId, vault) {
  await pool.execute(
    'UPDATE tribu_saved_cards SET is_default = 0 WHERE tribu_user_id = ? AND activo = 1',
    [userId]
  );
  await pool.execute(
    `INSERT INTO tribu_saved_cards
      (tribu_user_id, culqi_customer_id, culqi_card_id, culqi_card_brand, last_four_digits, exp_month, exp_year, is_default, activo)
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
      vault.customerId,
      vault.cardId,
      vault.cardBrand || null,
      vault.lastFour || null,
      vault.expMonth || null,
      vault.expYear || null,
    ]
  );
}

async function setDefaultSavedCard(userId, cardRowId) {
  const card = await getSavedCardForUser(userId, cardRowId);
  if (!card) return null;
  await pool.execute(
    'UPDATE tribu_saved_cards SET is_default = 0 WHERE tribu_user_id = ? AND activo = 1',
    [userId]
  );
  await pool.execute(
    'UPDATE tribu_saved_cards SET is_default = 1 WHERE id = ? AND tribu_user_id = ?',
    [cardRowId, userId]
  );
  return card;
}

async function deactivateSavedCard(userId, cardRowId) {
  const card = await getSavedCardForUser(userId, cardRowId);
  if (!card) return false;
  await pool.execute(
    'UPDATE tribu_saved_cards SET activo = 0, is_default = 0 WHERE id = ? AND tribu_user_id = ?',
    [cardRowId, userId]
  );
  await pool.execute(
    'UPDATE tribu_suscripciones SET auto_renovacion = 0 WHERE tribu_user_id = ? AND culqi_card_id = ?',
    [userId, card.culqi_card_id]
  );
  return true;
}

async function applySavedCardToSubscription(userId, tribuSubId, cardRowId) {
  const [[sub]] = await pool.execute(
    `SELECT ts.id, (ts.activo = 1 AND ts.fecha_fin >= CURDATE()) AS vigente
     FROM tribu_suscripciones ts
     WHERE ts.id = ? AND ts.tribu_user_id = ? LIMIT 1`,
    [tribuSubId, userId]
  );
  if (!sub) return { ok: false, error: 'Suscripción no encontrada' };
  if (!sub.vigente) return { ok: false, error: 'La suscripción no está vigente' };

  const card = await getSavedCardForUser(userId, cardRowId);
  if (!card) return { ok: false, error: 'Tarjeta no encontrada' };

  await setDefaultSavedCard(userId, cardRowId);
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET culqi_customer_id = ?, culqi_card_id = ?, culqi_card_brand = ?,
         auto_renovacion = 1, cancelada_at = NULL
     WHERE id = ? AND tribu_user_id = ?`,
    [card.culqi_customer_id, card.culqi_card_id, card.culqi_card_brand, tribuSubId, userId]
  );
  return { ok: true };
}

module.exports = {
  listSavedCards,
  getSavedCardForUser,
  upsertSavedCard,
  setDefaultSavedCard,
  deactivateSavedCard,
  applySavedCardToSubscription,
  formatCardPublic,
};
