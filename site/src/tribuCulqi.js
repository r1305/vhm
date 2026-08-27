/**
 * Culqi — cargos únicos + tarjetas guardadas (Customer/Card API) para renovaciones.
 */
const crypto = require('crypto');
const pool = require('./db');

const CULQI_API = 'https://api.culqi.com/v2';

async function getCulqiConfig() {
  const [rows] = await pool.execute(
    'SELECT activo, secret_key, modo, public_key FROM config_culqi WHERE id = 1'
  );
  const cfg = rows[0];
  if (!cfg || !cfg.activo || !cfg.secret_key) {
    throw new Error('Culqi no está configurado o activo');
  }
  return cfg;
}

function formatAmountCents(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Monto inválido');
  return Math.round(n * 100);
}

function buildExternalRef(userId, planId) {
  return `tribu-${userId}-${planId}-${Date.now()}`;
}

function buildRenewExternalRef(tribuSubId) {
  return `tribu-renew-${tribuSubId}-${Date.now()}`;
}

function parseExternalRef(ref) {
  const raw = String(ref || '');
  if (raw.startsWith('tribu-renew-')) {
    const parts = raw.split('-');
    return { type: 'renew', tribuSubId: Number.parseInt(parts[2] || '0', 10) };
  }
  const parts = raw.includes('-') ? raw.split('-') : raw.split('_');
  return {
    type: 'initial',
    userId: Number.parseInt(parts[1] || '0', 10),
    planId: Number.parseInt(parts[2] || '0', 10),
  };
}

function getWebhookUrl() {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!siteUrl || !/^https?:\/\//i.test(siteUrl)) return undefined;
  return `${siteUrl}/api/tribu-pagos/webhook`;
}

function resolvePayerEmail(formEmail, userEmail, culqiModo, billingEmail) {
  const fromForm = String(formEmail || '').trim().toLowerCase();
  if (culqiModo === 'sandbox') {
    return fromForm || String(userEmail || '').trim().toLowerCase() || 'test@culqi.com';
  }
  const billing = String(billingEmail || '').trim().toLowerCase();
  if (billing) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing)) {
      throw new Error('Correo de facturación inválido');
    }
    return billing;
  }
  const email = fromForm || String(userEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Email del pagador requerido');
  return email;
}

function extractCheckoutPayload(body) {
  const tokenId = body.token_id || body.culqi_token || body.token;
  return {
    tokenId: tokenId ? String(tokenId).trim() : null,
    email: body.email || body.payer?.email,
    identificationType: body.identification_type || body.identificationType,
    identificationNumber: body.identification_number || body.identificationNumber,
  };
}

function parseCulqiPayloadErrors(payload) {
  const msg = payload?.merchant_message || payload?.user_message || payload?.message;
  if (msg) return String(msg);
  if (payload?.object === 'error') {
    return [payload.type, payload.param, payload.message].filter(Boolean).join(' · ');
  }
  return null;
}

function mapCulqiError(err) {
  const payload = err?.payload || {};
  const fromPayload = parseCulqiPayloadErrors(payload);
  if (fromPayload) return fromPayload;
  return err?.message || 'Error en Culqi';
}

function isTestSecretKey(secretKey) {
  return String(secretKey || '').startsWith('sk_test_');
}

function isTestPublicKey(publicKey) {
  return String(publicKey || '').startsWith('pk_test_');
}

function validateCulqiCredentials(secretKey, publicKey, modo) {
  const sk = String(secretKey || '').trim();
  const pk = String(publicKey || '').trim();
  if (!sk || !pk) throw new Error('Public Key y Secret Key son obligatorios');
  if (!/^sk_(test|live)_/.test(sk)) {
    throw new Error('Secret Key inválida. Debe empezar con sk_test_ o sk_live_.');
  }
  if (!/^pk_(test|live)_/.test(pk)) {
    throw new Error('Public Key inválida. Debe empezar con pk_test_ o pk_live_.');
  }
  const skTest = isTestSecretKey(sk);
  const pkTest = isTestPublicKey(pk);
  if (skTest !== pkTest) {
    throw new Error('Public Key y Secret Key deben ser del mismo entorno (test o live).');
  }
  if (modo === 'sandbox' && !skTest) {
    throw new Error('Para modo sandbox usa llaves pk_test_ / sk_test_ desde el CulqiPanel (Integración).');
  }
  if (modo === 'produccion' && skTest) {
    throw new Error('Para producción usa llaves pk_live_ / sk_live_ desde el CulqiPanel (Producción).');
  }
}

async function getCulqiCredentialInfo(secretKey) {
  const sk = String(secretKey || '').trim();
  if (!sk) return { ok: false, error: 'Sin Secret Key' };
  if (!/^sk_(test|live)_/.test(sk)) {
    return { ok: false, error: 'Secret Key con formato inválido' };
  }
  return {
    ok: true,
    live_mode: !isTestSecretKey(sk),
    is_test: isTestSecretKey(sk),
  };
}

function httpStatusForError(err) {
  const msg = String(err?.message || '');
  if (msg.includes('requerido') || msg.includes('inválido') || msg.includes('incompletos')) return 400;
  const status = Number(err?.status);
  if (status === 401 || status === 403) return 502;
  if (status >= 400 && status < 500) return status;
  return 500;
}

function culqiHeaders(secretKey, extra = {}) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function culqiFetch(secretKey, path, options = {}) {
  const res = await fetch(`${CULQI_API}${path}`, {
    ...options,
    headers: culqiHeaders(secretKey, options.headers),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(parseCulqiPayloadErrors(payload) || 'Error en Culqi');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function buildAntifraudDetails(user, identification) {
  const firstName = String(user?.nombre || 'Cliente').trim().slice(0, 50);
  const lastName = String(user?.apellido || 'Tribu').trim().slice(0, 50);
  const phone = String(user?.telefono || '999999999').replace(/\D/g, '').slice(0, 15) || '999999999';
  const details = {
    first_name: firstName,
    last_name: lastName,
    address: 'Lima',
    address_city: 'Lima',
    country_code: 'PE',
    phone_number: phone,
  };
  if (identification?.number) {
    details.address = `Doc ${identification.type || 'DNI'} ${identification.number}`.slice(0, 120);
  }
  return details;
}

function mapDocTypeToCulqi(type) {
  const t = String(type || 'DNI').toUpperCase();
  if (t === 'RUC') return 'RUC';
  if (t === 'CE' || t === 'CARNET_EXTRANJERIA') return 'CE';
  return 'DNI';
}

async function findOrCreateCustomer(secretKey, email, user, identification) {
  try {
    const listed = await culqiFetch(
      secretKey,
      `/customers?email=${encodeURIComponent(email)}&limit=1`
    );
    const existing = listed?.data?.[0];
    if (existing?.id) return existing;
  } catch {
    // continuar con creación
  }

  return culqiFetch(secretKey, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      email,
      first_name: String(user?.nombre || 'Cliente').trim().slice(0, 50),
      last_name: String(user?.apellido || 'Tribu').trim().slice(0, 50),
      phone_number: String(user?.telefono || '999999999').replace(/\D/g, '').slice(0, 15) || '999999999',
      antifraud_details: buildAntifraudDetails(user, identification),
      metadata: identification?.number
        ? { document_type: mapDocTypeToCulqi(identification.type), document_number: identification.number }
        : {},
    }),
  });
}

async function saveCustomerCard(secretKey, customerId, tokenId) {
  return culqiFetch(secretKey, '/cards', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: customerId,
      token_id: tokenId,
    }),
  });
}

function buildChargeBody({
  plan,
  email,
  user,
  identification,
  externalRef,
  sourceId,
  description,
}) {
  const amount = formatAmountCents(plan.precio);
  const body = {
    amount,
    currency_code: 'PEN',
    email,
    source_id: sourceId,
    capture: true,
    description: description || plan.nombre,
    antifraud_details: buildAntifraudDetails(user, identification),
    metadata: {
      external_reference: externalRef,
    },
  };
  if (identification?.type && identification?.number) {
    body.metadata.document_type = mapDocTypeToCulqi(identification.type);
    body.metadata.document_number = String(identification.number).trim();
  }
  return body;
}

async function createCulqiCharge(secretKey, body) {
  const idempotencyKey = crypto.randomUUID();
  return culqiFetch(secretKey, '/charges', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
}

async function fetchCulqiCharge(secretKey, chargeId) {
  return culqiFetch(secretKey, `/charges/${encodeURIComponent(chargeId)}`);
}

function resolveChargeOutcome(charge) {
  const type = charge?.outcome?.type;
  const code = charge?.outcome?.code;
  if (type === 'venta_exitosa' || code === 'AUT0000') {
    return {
      status: 'approved',
      status_detail: charge?.outcome?.merchant_message || null,
      charge_id: charge?.id || null,
      user_message: charge?.outcome?.user_message || null,
    };
  }
  if (charge?.action_code === 'REVIEW') {
    return {
      status: 'pending',
      status_detail: charge?.user_message || 'Requiere autenticación adicional',
      charge_id: charge?.id || null,
    };
  }
  return {
    status: 'rejected',
    status_detail: charge?.outcome?.merchant_message || charge?.outcome?.user_message || type || 'rejected',
    charge_id: charge?.id || null,
  };
}

function isChargePaid(charge) {
  return resolveChargeOutcome(charge).status === 'approved';
}

async function vaultCustomerCard({ secretKey, email, tokenId, user, identification }) {
  const customer = await findOrCreateCustomer(secretKey, email, user, identification);
  const card = await saveCustomerCard(secretKey, customer.id, tokenId);
  const brand = card?.iin?.card_brand || card?.source?.iin?.card_brand || null;
  return {
    customerId: String(customer.id),
    cardId: String(card.id),
    cardBrand: brand ? String(brand).toLowerCase() : null,
    lastFour: card?.last_four || card?.source?.last_four || null,
    expMonth: card?.expiration_month || null,
    expYear: card?.expiration_year || null,
  };
}

async function vaultCustomerCardSafe(params) {
  try {
    const vault = await vaultCustomerCard(params);
    return { ok: true, vault };
  } catch (err) {
    console.warn('[tribu-culqi vault]', mapCulqiError(err));
    return { ok: false, error: err };
  }
}

function validateWebhookSignature(req) {
  const secret = process.env.CULQI_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers['x-culqi-signature'] || req.headers['culqi-signature'];
  if (!signature || typeof signature !== 'string') return false;

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = {
  getCulqiConfig,
  formatAmountCents,
  buildExternalRef,
  buildRenewExternalRef,
  parseExternalRef,
  getWebhookUrl,
  resolvePayerEmail,
  extractCheckoutPayload,
  mapCulqiError,
  httpStatusForError,
  buildChargeBody,
  createCulqiCharge,
  fetchCulqiCharge,
  resolveChargeOutcome,
  isChargePaid,
  vaultCustomerCard,
  vaultCustomerCardSafe,
  validateCulqiCredentials,
  getCulqiCredentialInfo,
  validateWebhookSignature,
};
