/**
 * Mercado Pago — Checkout API Orders + Customer/card vault para renovaciones.
 */
const crypto = require('crypto');
const pool = require('./db');

async function getMpConfig() {
  const [rows] = await pool.execute(
    'SELECT activo, access_token, modo, public_key FROM config_mercadopago WHERE id = 1'
  );
  const cfg = rows[0];
  if (!cfg || !cfg.activo || !cfg.access_token) {
    throw new Error('MercadoPago no está configurado o activo');
  }
  return cfg;
}

function formatAmount(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Monto inválido');
  return n.toFixed(2);
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

function getSandboxPayerEmail() {
  const email = (process.env.MP_SANDBOX_PAYER_EMAIL || 'test_user_123456789@testuser.com')
    .trim()
    .toLowerCase();
  return email.includes('@testuser.com') ? email : 'test_user_123456789@testuser.com';
}

function resolvePayerEmail(brickEmail, userEmail, mpModo) {
  const fromBrick = String(brickEmail || '').trim().toLowerCase();
  if (mpModo === 'sandbox') {
    const configured = getSandboxPayerEmail();
    if (fromBrick && fromBrick !== configured) {
      throw new Error(
        `El email del pago (${fromBrick}) no coincide con el comprador de prueba (${configured}). `
        + 'Configura MP_SANDBOX_PAYER_EMAIL con el email de tu cuenta comprador de prueba.'
      );
    }
    return fromBrick || configured;
  }
  const email = fromBrick || String(userEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Email del pagador requerido');
  return email;
}

function extractBrickPayload(body) {
  const payer = body.payer || {};
  const identification = payer.identification || body.identification || {};
  const paymentTypeId = body.payment_type_id || body.paymentTypeId || 'credit_card';
  return {
    token: body.token,
    paymentMethodId: body.payment_method_id || body.paymentMethodId,
    paymentType: paymentTypeId === 'debit_card' ? 'debit_card' : 'credit_card',
    installments: Number(body.installments || 1),
    email: payer.email || body.email,
    identificationType: identification.type || body.identificationType || body.identification_type,
    identificationNumber: identification.number || body.identificationNumber || body.identification_number,
  };
}

function parseMpPayloadErrors(payload) {
  const list = payload?.errors || payload?.cause || [];
  if (!Array.isArray(list) || !list.length) return null;
  const parts = list.flatMap((entry) => {
    const chunk = [entry.message, entry.description, entry.code].filter(Boolean);
    if (Array.isArray(entry.details)) chunk.push(...entry.details);
    return chunk;
  });
  return parts.length ? parts.join(' · ') : null;
}

function mapMpError(err) {
  const payload = err?.payload || {};
  const code = String(payload.code || payload?.cause?.[0]?.code || '');
  const causeText = [
    payload.message,
    payload?.cause?.[0]?.description,
    parseMpPayloadErrors(payload),
  ].filter(Boolean).join(' ');
  if (code === 'guest_site_mismatch') {
    return 'Mercado Pago rechazó el pago: el email del comprador no coincide con el token de la tarjeta. '
      + 'En sandbox usa MP_SANDBOX_PAYER_EMAIL del comprador de prueba de tu aplicación.';
  }
  if (code === '300' || /live credentials/i.test(causeText)) {
    return 'Mercado Pago detectó credenciales de PRODUCCIÓN en un flujo de prueba. '
      + 'Con Orders API, Public Key y Access Token de prueba también empiezan con APP_USR-; '
      + 'debes copiarlos desde Pruebas → Credenciales de prueba (no desde Producción).';
  }
  const fromPayload = parseMpPayloadErrors(payload);
  if (fromPayload) return fromPayload;
  return err?.message || 'Error en Mercado Pago';
}

async function fetchMpUserMe(accessToken) {
  const res = await fetch('https://api.mercadopago.com/users/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, payload };
}

async function validateMpCredentialsForModo(accessToken, publicKey, modo) {
  const token = String(accessToken || '').trim();
  const pk = String(publicKey || '').trim();
  if (!token) throw new Error('Access Token requerido');
  if (!pk) throw new Error('Public Key requerida');

  const mpKey = /^(APP_USR-|TEST-)/;
  if (!mpKey.test(pk) || !mpKey.test(token)) {
    throw new Error('Public Key y Access Token deben empezar con APP_USR- o TEST-');
  }

  const { ok, payload } = await fetchMpUserMe(token);
  if (!ok) {
    throw new Error(parseMpPayloadErrors(payload) || 'Access Token inválido o revocado');
  }

  const liveMode = payload.live_mode === true;
  if (modo === 'sandbox' && liveMode) {
    throw new Error(
      'Este Access Token es de PRODUCCIÓN (live_mode=true). El prefijo APP_USR- no indica prueba: '
      + 'copia el par desde Tus integraciones → Pruebas → Credenciales de prueba. '
      + 'Si no aparecen, pulsa "Activar credenciales" en esa sección.'
    );
  }
  if (modo === 'produccion' && !liveMode) {
    throw new Error(
      'Este Access Token es de PRUEBA (live_mode=false). Para producción usa '
      + 'Tus integraciones → Producción → Credenciales de producción.'
    );
  }
}

async function getMpCredentialInfo(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return { ok: false, error: 'Sin Access Token' };
  const { ok, payload } = await fetchMpUserMe(token);
  if (!ok) {
    return { ok: false, error: parseMpPayloadErrors(payload) || 'Token inválido' };
  }
  return {
    ok: true,
    live_mode: payload.live_mode === true,
    mp_user_id: payload.id || null,
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

function mpHeaders(accessToken, mpModo, extra = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
  // Orders API (APP_USR): el entorno lo define live_mode del token, no X-scope.
  // X-scope: stage aplica a integraciones legacy TEST- / preapproval y provoca error 300
  // si se combina mal con tokens de producción.
  if (mpModo === 'sandbox' && String(accessToken).startsWith('TEST-')) {
    headers['X-scope'] = 'stage';
  }
  return headers;
}

async function mpFetch(accessToken, url, options = {}, mpModo = null) {
  const res = await fetch(url, {
    ...options,
    headers: mpHeaders(accessToken, mpModo, options.headers),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(parseMpPayloadErrors(payload) || 'Error en Mercado Pago');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function findOrCreateCustomer(accessToken, mpModo, email) {
  const encoded = encodeURIComponent(email);
  const search = await mpFetch(
    accessToken,
    `https://api.mercadopago.com/v1/customers/search?email=${encoded}`,
    {},
    mpModo
  );
  const existing = search?.results?.[0];
  if (existing?.id) return existing;
  return mpFetch(accessToken, 'https://api.mercadopago.com/v1/customers', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }, mpModo);
}

async function saveCustomerCard(accessToken, mpModo, customerId, token) {
  return mpFetch(
    accessToken,
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(customerId)}/cards`,
    { method: 'POST', body: JSON.stringify({ token }) },
    mpModo
  );
}

function buildOrderBody({
  plan,
  email,
  identification,
  externalRef,
  callbackUrl,
  paymentMethodId,
  paymentType,
  token,
  customerId,
  cardId,
}) {
  const amount = formatAmount(plan.precio);
  const payer = { email };
  if (customerId) payer.customer_id = String(customerId);
  if (identification?.type && identification?.number) {
    payer.identification = {
      type: identification.type,
      number: String(identification.number).trim(),
    };
  }

  const paymentMethod = {
    id: paymentMethodId,
    type: paymentType || 'credit_card',
    installments: 1,
    statement_descriptor: 'La Tribu VHM',
  };
  if (cardId) {
    paymentMethod.card_id = String(cardId);
  } else if (token) {
    paymentMethod.token = token;
  } else {
    throw new Error('Método de pago incompleto');
  }

  const body = {
    type: 'online',
    processing_mode: 'automatic',
    total_amount: amount,
    external_reference: externalRef,
    currency: 'PEN',
    description: plan.nombre,
    payer,
    transactions: { payments: [{ amount, payment_method: paymentMethod }] },
    items: [{
      title: plan.nombre,
      unit_price: amount,
      quantity: 1,
      category_id: 'services',
    }],
  };
  if (callbackUrl) body.config = { online: { callback_url: callbackUrl } };
  return body;
}

async function createMpOrder(accessToken, body, mpModo) {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: mpHeaders(accessToken, mpModo, { 'X-Idempotency-Key': idempotencyKey }),
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 402 && payload?.data) return payload.data;
  if (!res.ok) {
    const err = new Error(parseMpPayloadErrors(payload) || 'Error al procesar el pago');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload?.data || payload;
}

async function fetchMpOrder(accessToken, orderId, mpModo) {
  return mpFetch(
    accessToken,
    `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
    {},
    mpModo
  );
}

function resolvePaymentOutcome(orderResult) {
  const payment = orderResult?.transactions?.payments?.[0];
  const paymentStatus = payment?.status;
  const orderStatus = orderResult?.status;

  if (paymentStatus === 'approved' || orderStatus === 'processed') {
    return {
      status: 'approved',
      status_detail: payment?.status_detail || orderResult?.status_detail || null,
      order_id: orderResult?.id || null,
      payment_id: payment?.id || null,
      order_status: orderStatus || null,
    };
  }
  if (
    paymentStatus === 'pending' ||
    paymentStatus === 'in_process' ||
    orderStatus === 'action_required' ||
    orderStatus === 'created'
  ) {
    return {
      status: paymentStatus || 'pending',
      status_detail: payment?.status_detail || orderResult?.status_detail || null,
      order_id: orderResult?.id || null,
      payment_id: payment?.id || null,
      order_status: orderStatus || null,
    };
  }
  return {
    status: paymentStatus || orderStatus || 'rejected',
    status_detail: payment?.status_detail || orderResult?.status_detail || null,
    order_id: orderResult?.id || null,
    payment_id: payment?.id || null,
    order_status: orderStatus || null,
  };
}

function isOrderPaid(orderResult) {
  return resolvePaymentOutcome(orderResult).status === 'approved';
}

async function vaultCustomerCard({ accessToken, mpModo, email, token }) {
  const customer = await findOrCreateCustomer(accessToken, mpModo, email);
  const card = await saveCustomerCard(accessToken, mpModo, customer.id, token);
  return {
    customerId: String(customer.id),
    cardId: String(card.id),
  };
}

module.exports = {
  getMpConfig,
  formatAmount,
  buildExternalRef,
  buildRenewExternalRef,
  parseExternalRef,
  getWebhookUrl,
  resolvePayerEmail,
  extractBrickPayload,
  mapMpError,
  httpStatusForError,
  buildOrderBody,
  createMpOrder,
  fetchMpOrder,
  resolvePaymentOutcome,
  isOrderPaid,
  vaultCustomerCard,
  validateMpCredentialsForModo,
  getMpCredentialInfo,
};
