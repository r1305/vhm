/**
 * Culqi — cargos únicos + tarjetas guardadas (Customer/Card API) para renovaciones.
 */
const crypto = require('crypto');
const pool = require('./db');

const CULQI_API = 'https://api.culqi.com/v2';
const CULQI_TIMEOUT_MS = 20000;

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

function ymdLima(value) {
  if (value instanceof Date) {
    return value.toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).replace(/\D/g, '');
  }
  return String(value || '').slice(0, 10).replace(/\D/g, '');
}

function buildRenewalIdempotencyKey(tribuSubId, fechaFin, intento) {
  const n = Number.parseInt(intento, 10);
  return `ren_${tribuSubId}_${ymdLima(fechaFin)}_${Number.isFinite(n) ? n : 0}`.slice(0, 64);
}

function buildPaymentIdempotencyKey(userId, requestId) {
  const rid = String(requestId || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(rid)) return null;
  return `pay_${userId}_${rid}`.slice(0, 64);
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
  if (err?.timeout || err?.network) return 504;
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
  let res;
  try {
    res = await fetch(`${CULQI_API}${path}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(CULQI_TIMEOUT_MS),
      headers: culqiHeaders(secretKey, options.headers),
    });
  } catch (fetchErr) {
    const isTimeout = fetchErr?.name === 'TimeoutError' || fetchErr?.name === 'AbortError';
    const err = new Error(isTimeout ? 'Culqi no respondió a tiempo' : 'No se pudo conectar con Culqi');
    err.timeout = isTimeout;
    err.network = true;
    err.unknownOutcome = String(options.method || 'GET').toUpperCase() !== 'GET';
    err.cause = fetchErr;
    throw err;
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(parseCulqiPayloadErrors(payload) || 'Error en Culqi');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function buildCulqiAddress(identification) {
  const street = 'Av. Lima 123, San Isidro';
  if (identification?.number) {
    const doc = `${identification.type || 'DNI'} ${String(identification.number).trim()}`;
    const withDoc = `${street}, ${doc}`.slice(0, 99);
    if (withDoc.length >= 6) return withDoc;
  }
  return street;
}

function mapDocTypeToCulqi(type) {
  const t = String(type || 'DNI').toUpperCase();
  if (t === 'RUC') return 'RUC';
  if (t === 'CE' || t === 'CARNET_EXTRANJERIA') return 'CE';
  return 'DNI';
}

function buildAntifraudDetails(user, identification) {
  const firstName = String(user?.nombre || 'Cliente').trim().slice(0, 50);
  const lastName = String(user?.apellido || 'Tribu').trim().slice(0, 50);
  const phone = normalizePeruPhone(user?.telefono);
  return {
    first_name: firstName,
    last_name: lastName,
    address: buildCulqiAddress(identification),
    address_city: 'San Isidro',
    country_code: 'PE',
    phone_number: phone,
  };
}

function buildCustomerBody(user, identification, email) {
  const antifraud = buildAntifraudDetails(user, identification);
  return {
    email,
    first_name: antifraud.first_name,
    last_name: antifraud.last_name,
    phone_number: antifraud.phone_number,
    // Culqi exige address/address_city en la raíz al crear o actualizar clientes
    address: antifraud.address,
    address_city: antifraud.address_city,
    country_code: antifraud.country_code,
    antifraud_details: antifraud,
    metadata: identification?.number
      ? {
          document_type: mapDocTypeToCulqi(identification.type),
          document_number: String(identification.number).trim(),
        }
      : {},
  };
}

async function syncCustomerProfile(secretKey, customerId, user, identification, email) {
  const body = buildCustomerBody(user, identification, email);
  await culqiFetch(secretKey, `/customers/${encodeURIComponent(String(customerId))}`, {
    method: 'PATCH',
    body: JSON.stringify({
      first_name: body.first_name,
      last_name: body.last_name,
      phone_number: body.phone_number,
      address: body.address,
      address_city: body.address_city,
      country_code: body.country_code,
      antifraud_details: body.antifraud_details,
    }),
  });
}

async function findOrCreateCustomer(secretKey, email, user, identification) {
  let existing = null;
  try {
    const listed = await culqiFetch(
      secretKey,
      `/customers?email=${encodeURIComponent(email)}&limit=1`
    );
    existing = listed?.data?.[0] || null;
  } catch {
    // continuar con creación
  }

  if (existing?.id) {
    try {
      await syncCustomerProfile(secretKey, existing.id, user, identification, email);
    } catch (err) {
      console.warn('[tribu-culqi customer sync]', mapCulqiError(err));
    }
    return existing;
  }

  return culqiFetch(secretKey, '/customers', {
    method: 'POST',
    body: JSON.stringify(buildCustomerBody(user, identification, email)),
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

async function createCulqiCharge(secretKey, body, idempotencyKey) {
  const key = String(idempotencyKey || crypto.randomUUID()).slice(0, 64);
  return culqiFetch(secretKey, '/charges', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': key },
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

function normalizePeruPhone(telefono) {
  const digits = String(telefono || '').replace(/\D/g, '');
  if (digits.length >= 9) return digits.slice(-9);
  return '999999999';
}

function parseCulqiCardRecord(card, fallbackCustomerId) {
  const cardId = card?.id || card?.card_id || null;
  if (!cardId || !String(cardId).startsWith('crd_')) {
    throw new Error('Culqi no devolvió una tarjeta guardada válida');
  }
  const tokenBlock = card?.token || card?.source || {};
  const brandRaw =
    card?.iin?.card_brand ||
    tokenBlock?.iin?.card_brand ||
    card?.source?.iin?.card_brand ||
    null;
  const lastFour =
    card?.last_four ||
    tokenBlock?.last_four ||
    card?.source?.last_four ||
    null;
  const customerId = card?.customer_id || fallbackCustomerId || null;
  if (!customerId || !String(customerId).startsWith('cus_')) {
    throw new Error('Culqi no devolvió un cliente válido para la tarjeta');
  }
  return {
    customerId: String(customerId),
    cardId: String(cardId),
    cardBrand: brandRaw ? String(brandRaw).toLowerCase() : null,
    lastFour: lastFour ? String(lastFour).slice(-4) : null,
    expMonth: card?.expiration_month || tokenBlock?.expiration_month || null,
    expYear: card?.expiration_year || tokenBlock?.expiration_year || null,
  };
}

function extractVaultFromCharge(charge) {
  if (!charge || typeof charge !== 'object') return null;
  const sourceId = charge.source_id || charge.source?.id || null;
  if (!sourceId || !String(sourceId).startsWith('crd_')) return null;
  const source = charge.source || {};
  const customerId = source.customer_id || charge.customer_id || null;
  if (!customerId) return null;
  const brandRaw = source.iin?.card_brand || source.card_brand || null;
  return {
    customerId: String(customerId),
    cardId: String(sourceId),
    cardBrand: brandRaw ? String(brandRaw).toLowerCase() : null,
    lastFour: source.last_four ? String(source.last_four).slice(-4) : null,
    expMonth: null,
    expYear: null,
  };
}

async function vaultCustomerCard({ secretKey, email, tokenId, user, identification }) {
  const customer = await findOrCreateCustomer(secretKey, email, user, identification);
  const card = await saveCustomerCard(secretKey, customer.id, tokenId);
  return parseCulqiCardRecord(card, customer.id);
}

async function vaultCustomerCardSafe(params) {
  try {
    const vault = await vaultCustomerCard(params);
    if (!vault?.cardId || !vault?.customerId) {
      throw new Error('No se pudo vincular la tarjeta al cliente en Culqi');
    }
    return { ok: true, vault };
  } catch (err) {
    const message = mapCulqiError(err);
    console.warn('[tribu-culqi vault]', message, err.payload || err.message || '');
    return { ok: false, error: err, errorMessage: message };
  }
}

/*
 * Verificación del webhook de Culqi.
 * Culqi no documenta de forma estable un esquema de firma HMAC para los eventos
 * de cargos, así que la verificación es configurable con CULQI_WEBHOOK_AUTH:
 *   - "hmac"  (por defecto): cabecera x-culqi-signature / culqi-signature con
 *             HMAC-SHA256 en hex del cuerpo crudo (req.rawBody) usando
 *             CULQI_WEBHOOK_SECRET. Se acepta opcionalmente el prefijo "sha256=".
 *   - "basic": Authorization: Basic con "usuario:clave" igual a
 *             CULQI_WEBHOOK_SECRET (credenciales configuradas en la URL del
 *             webhook en CulqiPanel: https://usuario:clave@host/...).
 *   - "token": cabecera x-webhook-token igual a CULQI_WEBHOOK_SECRET.
 * La firma solo filtra ruido: la garantía real es que el cargo SIEMPRE se
 * vuelve a consultar en la API de Culqi con la secret key antes de aplicarlo,
 * y se valida monto, moneda, referencia y estado.
 */
function webhookSecretState() {
  const secret = String(process.env.CULQI_WEBHOOK_SECRET || '');
  const production = process.env.NODE_ENV === 'production';
  return { secret, configured: !!secret, failClosed: production && !secret };
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function validateWebhookSignature(req) {
  const { secret } = webhookSecretState();
  if (!secret) return process.env.NODE_ENV !== 'production';

  const mode = String(process.env.CULQI_WEBHOOK_AUTH || 'hmac').toLowerCase();
  if (mode === 'basic') {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Basic ')) return false;
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    return safeEqual(decoded, secret);
  }
  if (mode === 'token') {
    const token = req.headers['x-webhook-token'];
    return typeof token === 'string' && safeEqual(token, secret);
  }

  let signature = req.headers['x-culqi-signature'] || req.headers['culqi-signature'];
  if (!signature || typeof signature !== 'string') return false;
  signature = signature.trim().replace(/^sha256=/i, '');
  if (typeof req.rawBody !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(signature.toLowerCase(), expected);
}

const WEBHOOK_CHARGE_SUCCESS = /^charge\.(?:(?:creation|update)\.)?(?:succeeded|success|successful|completed)$/i;

function parseWebhookEvent(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const eventType = String(payload.type || payload.event || '').trim();
  let data = payload.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  if (!data || typeof data !== 'object') data = null;
  const candidate = data?.id || (payload.object === 'charge' ? payload.id : null);
  const chargeId = typeof candidate === 'string' && /^chr_[A-Za-z0-9_]{4,60}$/.test(candidate) ? candidate : null;
  return {
    eventType,
    chargeId,
    isChargeSuccess: WEBHOOK_CHARGE_SUCCESS.test(eventType),
  };
}

function validateChargeForPlan(charge, plan) {
  if (!charge || typeof charge !== 'object') return { ok: false, reason: 'cargo_vacio' };
  if (resolveChargeOutcome(charge).status !== 'approved') return { ok: false, reason: 'no_aprobado' };
  if (String(charge.currency_code || '').toUpperCase() !== 'PEN') return { ok: false, reason: 'moneda' };
  const ref = String(charge?.metadata?.external_reference || '');
  if (!ref.startsWith('tribu-')) return { ok: false, reason: 'referencia' };
  if (!plan) return { ok: false, reason: 'plan' };
  const expected = Math.round(Number(plan.precio) * 100);
  if (!Number.isFinite(expected) || Number(charge.amount) !== expected) return { ok: false, reason: 'monto' };
  return { ok: true };
}

module.exports = {
  getCulqiConfig,
  formatAmountCents,
  buildExternalRef,
  buildRenewExternalRef,
  buildRenewalIdempotencyKey,
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
  extractVaultFromCharge,
  validateCulqiCredentials,
  getCulqiCredentialInfo,
  validateWebhookSignature,
  webhookSecretState,
  parseWebhookEvent,
  validateChargeForPlan,
  buildPaymentIdempotencyKey,
  CULQI_TIMEOUT_MS,
};
