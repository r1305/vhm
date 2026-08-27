const pool = require('./db');
const { resolveChargeOutcome, parseExternalRef } = require('./tribuCulqi');

function maskEmail(email) {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at <= 0) return '***';
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const maskedLocal = local.length <= 1 ? '*' : `${local[0]}***`;
  return `${maskedLocal}@${domain}`;
}

function maskDocument(number) {
  if (number == null || number === '') return null;
  const digits = String(number).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function extractCardInfo(charge) {
  const source = charge?.source;
  const lastFour = source?.last_four || charge?.last_four || null;
  const brandRaw =
    source?.iin?.card_brand ||
    source?.card_brand ||
    source?.iin?.brand ||
    null;
  const brand = brandRaw ? String(brandRaw).toLowerCase().slice(0, 20) : null;
  return {
    lastFour: lastFour ? String(lastFour).slice(-4) : null,
    brand,
  };
}

function sanitizeChargePayload(charge) {
  if (!charge || typeof charge !== 'object') return null;
  const card = extractCardInfo(charge);
  return {
    id: charge.id || null,
    amount: charge.amount ?? null,
    currency_code: charge.currency_code || null,
    capture: charge.capture ?? null,
    description: charge.description ? String(charge.description).slice(0, 255) : null,
    creation_date: charge.creation_date || charge.created_at || null,
    outcome: charge.outcome
      ? {
          type: charge.outcome.type || null,
          code: charge.outcome.code || null,
          merchant_message: charge.outcome.merchant_message || null,
          user_message: charge.outcome.user_message || null,
        }
      : null,
    metadata: charge.metadata
      ? {
          external_reference: charge.metadata.external_reference || null,
          document_type: charge.metadata.document_type || null,
          document_number: maskDocument(charge.metadata.document_number),
        }
      : null,
    action_code: charge.action_code || null,
    source: charge.source
      ? {
          object: charge.source.object || null,
          card_brand: card.brand,
          last_four: card.lastFour,
        }
      : null,
  };
}

function resolveContextIds(charge, context = {}) {
  const externalRef = charge?.metadata?.external_reference;
  const parsed = parseExternalRef(externalRef);
  return {
    tribuUserId: context.tribuUserId ?? parsed.userId ?? null,
    planId: context.planId ?? parsed.planId ?? null,
    tribuSuscripcionId: context.tribuSuscripcionId ?? null,
  };
}

async function recordCulqiTransaction(charge, context = {}) {
  if (!charge || typeof charge !== 'object') return null;

  const outcome = resolveChargeOutcome(charge);
  const chargeId = outcome.charge_id || charge.id;
  if (!chargeId) return null;

  const ids = resolveContextIds(charge, context);
  const card = extractCardInfo(charge);
  const payload = sanitizeChargePayload(charge);
  const source = String(context.source || 'api').slice(0, 30);
  const email = charge.email || context.payerEmail || null;

  try {
    await pool.execute(
      `INSERT INTO tribu_culqi_transactions
        (culqi_charge_id, tribu_user_id, suscripcion_plan_id, tribu_suscripcion_id,
         amount_cents, currency_code, status, outcome_type, outcome_code,
         merchant_message, user_message, external_reference, event_source,
         card_brand, card_last_four, payer_email_masked, culqi_created_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         tribu_user_id = COALESCE(VALUES(tribu_user_id), tribu_user_id),
         suscripcion_plan_id = COALESCE(VALUES(suscripcion_plan_id), suscripcion_plan_id),
         tribu_suscripcion_id = COALESCE(VALUES(tribu_suscripcion_id), tribu_suscripcion_id),
         status = VALUES(status),
         outcome_type = VALUES(outcome_type),
         outcome_code = VALUES(outcome_code),
         merchant_message = VALUES(merchant_message),
         user_message = VALUES(user_message),
         event_source = IF(
           LOCATE(VALUES(event_source), event_source) > 0,
           event_source,
           CONCAT_WS(',', event_source, VALUES(event_source))
         ),
         payload_json = VALUES(payload_json)`,
      [
        String(chargeId),
        ids.tribuUserId,
        ids.planId,
        ids.tribuSuscripcionId,
        charge.amount != null ? Number(charge.amount) : null,
        charge.currency_code ? String(charge.currency_code).slice(0, 3) : 'PEN',
        outcome.status,
        charge.outcome?.type ? String(charge.outcome.type).slice(0, 40) : null,
        charge.outcome?.code ? String(charge.outcome.code).slice(0, 20) : null,
        outcome.status_detail ? String(outcome.status_detail).slice(0, 255) : null,
        charge.outcome?.user_message
          ? String(charge.outcome.user_message).slice(0, 255)
          : null,
        charge.metadata?.external_reference
          ? String(charge.metadata.external_reference).slice(0, 64)
          : null,
        source,
        card.brand,
        card.lastFour,
        maskEmail(email),
        charge.creation_date || charge.created_at || null,
        payload ? JSON.stringify(payload) : null,
      ]
    );
    return String(chargeId);
  } catch (err) {
    console.error('[tribu-culqi-transaction-log]', err.message);
    return null;
  }
}

module.exports = {
  maskEmail,
  maskDocument,
  sanitizeChargePayload,
  recordCulqiTransaction,
};
