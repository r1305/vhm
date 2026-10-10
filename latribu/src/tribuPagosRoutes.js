const { Router } = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { tribuAuthMiddleware } = require('./tribuAuthRoutes');
const {
  getCulqiConfig, buildExternalRef, resolvePayerEmail, extractCheckoutPayload,
  mapCulqiError, httpStatusForError, buildChargeBody, createCulqiCharge,
  fetchCulqiCharge, resolveChargeOutcome, validateCulqiCredentials,
  validateWebhookSignature, vaultCustomerCardSafe, extractVaultFromCharge,
  webhookSecretState, parseWebhookEvent, buildPaymentIdempotencyKey,
} = require('./tribuCulqi');
const bcrypt = require('bcryptjs');
const {
  activateNewSubscription, activateTrialSubscription, applyApprovedCharge, runRenovacionesSuscripciones,
  acquireRenovacionesLock, releaseRenovacionesLock,
} = require('./tribuRenovaciones');
const { splitDisplayName, trialDaysFromEnv, formatRenewalDateLima } = require('../lib/tribuFunnel');
const { issueSessionForUserId } = require('./tribuAuthRoutes');
const { recordCulqiTransaction } = require('./tribuCulqiTransactionLog');
const { getSavedCard, upsertSavedCard } = require('./tribuSavedCards');
const { authMiddleware } = require('./auth');
const { requireAcceso } = require('./lib/accesos');
const { crearLimitador, ipDe, responder429 } = require('./lib/rateLimitMemoria');

const router = Router();

const HORA_MS = 60 * 60 * 1000;
const limitePruebaIp = crearLimitador({ max: 3, ventanaMs: HORA_MS });
const limitePruebaEmail = crearLimitador({ max: 3, ventanaMs: HORA_MS });
const limitePagoIp = crearLimitador({ max: 20, ventanaMs: 15 * 60 * 1000 });
const limitePagoUsuario = crearLimitador({ max: 10, ventanaMs: 15 * 60 * 1000 });
const pagosEnCurso = new Set();

const MSG_CUENTA_EXISTENTE = 'Ya tienes una cuenta con este correo. Inicia sesión para continuar.';

function validateCulqiConfig(cfg) {
  const pk = String(cfg.public_key || '').trim();
  const sk = String(cfg.secret_key || '').trim();
  if (!pk || !sk) throw new Error('Configura Public Key y Secret Key de Culqi en el panel de administración.');
  validateCulqiCredentials(sk, pk, cfg.modo);
}

async function savePayerProfile(userId, identificationType, identificationNumber, billingEmail) {
  const billing = billingEmail ? String(billingEmail).trim().toLowerCase().slice(0, 150) : null;
  if (billing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing)) throw new Error('Correo de facturación inválido');
  if (!identificationType && !identificationNumber && !billing) return;
  await pool.execute(
    `INSERT INTO tribu_payer_profiles (tribu_user_id, identification_type, identification_number, billing_email)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       identification_type = COALESCE(VALUES(identification_type), identification_type),
       identification_number = COALESCE(VALUES(identification_number), identification_number),
       billing_email = COALESCE(VALUES(billing_email), billing_email)`,
    [userId, identificationType || null, identificationNumber ? String(identificationNumber).trim() : null, billing]
  );
}

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

function validateCronToken(req) {
  const secret = process.env.TRIBU_RENOVACION_CRON_SECRET;
  if (!secret) return false;
  const token = req.headers['x-cron-token'];
  if (!token || typeof token !== 'string') return false;
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

async function fetchTribuUser(userId) {
  const [[user]] = await pool.execute(
    'SELECT nombre, apellido, email, telefono FROM tribu_users WHERE id = ? LIMIT 1', [userId]
  );
  return user || {};
}

async function crearUsuarioPrueba(nombre, apellido, emailNorm) {
  const randomSecret = crypto.randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(randomSecret, 12);
  const [result] = await pool.execute(
    `INSERT INTO tribu_users (nombre, apellido, email, password, psw_temp, is_suscribed, estado, consentimiento, consentimiento_at)
     VALUES (?, ?, ?, ?, 1, 0, 'activo', 1, NOW())`,
    [nombre, apellido, emailNorm, hash]
  );
  return result.insertId;
}

async function eliminarUsuarioPruebaFallida(userId) {
  try {
    await pool.execute(
      `DELETE FROM tribu_users WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM tribu_suscripciones ts WHERE ts.tribu_user_id = ?)`,
      [userId, userId]
    );
  } catch (err) {
    console.error('[tribu-pagos iniciar-prueba] no se pudo revertir usuario', userId, err.message);
  }
}

function cuentaExistente(res) {
  return res.status(409).json({ error: MSG_CUENTA_EXISTENTE, code: 'cuenta_existente' });
}

router.post('/iniciar-prueba', async (req, res) => {
  let createdUserId = null;
  let trialActivada = false;
  try {
    const {
      nombre, email, suscripcion_id: planIdRaw, terms_accepted: termsRaw, utm_source, utm_campaign,
      ...rawForm
    } = req.body || {};
    if (!nombre || !email) return res.status(400).json({ error: 'Nombre y correo son obligatorios' });
    const termsOk = termsRaw === true || termsRaw === 1 || termsRaw === '1' || termsRaw === 'on';
    if (!termsOk) return res.status(400).json({ error: 'Debes aceptar los términos para continuar' });

    const emailNorm = String(email).trim().toLowerCase();
    if (emailNorm.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm))
      return res.status(400).json({ error: 'Correo electrónico inválido' });

    const rlIp = limitePruebaIp.consumir(ipDe(req));
    if (!rlIp.ok) return responder429(res, rlIp);
    const rlEmail = limitePruebaEmail.consumir(emailNorm);
    if (!rlEmail.ok) return responder429(res, rlEmail);

    const [existentes] = await pool.execute('SELECT id FROM tribu_users WHERE email = ? LIMIT 1', [emailNorm]);
    if (existentes.length) return cuentaExistente(res);

    const cfg = await getCulqiConfig();
    validateCulqiConfig(cfg);

    const checkout = extractCheckoutPayload(rawForm);
    if (!checkout.tokenId) return res.status(400).json({ error: 'Token de pago requerido' });

    let planId = planIdRaw ? parseInt(String(planIdRaw), 10) : null;
    if (!planId) {
      const [plans] = await pool.execute(
        'SELECT id FROM suscripciones ORDER BY precio ASC, id ASC LIMIT 1'
      );
      planId = plans[0]?.id;
    }
    if (!planId) return res.status(503).json({ error: 'No hay plan de membresía configurado' });

    const [[plan]] = await pool.execute(
      'SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = ?', [planId]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const { nombre: nombreSplit, apellido: apellidoSplit } = splitDisplayName(nombre);
    const tribuUser = { nombre: nombreSplit, apellido: apellidoSplit, email: emailNorm, telefono: null };
    const identification = checkout.identificationType && checkout.identificationNumber
      ? { type: checkout.identificationType, number: String(checkout.identificationNumber).trim() }
      : null;
    const payerEmail = resolvePayerEmail(checkout.email, emailNorm, cfg.modo, null);

    const vaultResult = await vaultCustomerCardSafe({
      secretKey: cfg.secret_key,
      email: payerEmail,
      tokenId: checkout.tokenId,
      user: tribuUser,
      identification,
    });
    if (!vaultResult.ok || !vaultResult.vault?.cardId) {
      const msg = vaultResult.errorMessage || 'No se pudo validar la tarjeta';
      return res.status(400).json({ error: msg });
    }

    try {
      createdUserId = await crearUsuarioPrueba(nombreSplit, apellidoSplit, emailNorm);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return cuentaExistente(res);
      throw e;
    }
    const userId = createdUserId;

    try { await upsertSavedCard(userId, vaultResult.vault); } catch (e) {
      console.error('[tribu-pagos] guardar tarjeta trial', e.message);
    }
    await savePayerProfile(userId, checkout.identificationType, checkout.identificationNumber, cfg.modo === 'produccion' ? payerEmail : null);

    const trialDays = trialDaysFromEnv();
    const trial = await activateTrialSubscription({
      userId,
      planId: plan.id,
      trialDays,
      customerId: vaultResult.vault.customerId,
      cardId: vaultResult.vault.cardId,
      cardBrand: vaultResult.vault.cardBrand,
    });
    trialActivada = true;

    if (utm_source || utm_campaign) {
      try {
        await pool.execute(
          'UPDATE tribu_users SET fuente = ?, fuente_detalle = ? WHERE id = ?',
          [String(utm_source || 'utm').slice(0, 80), String(utm_campaign || '').slice(0, 200), userId]
        );
      } catch (_) {}
    }

    const session = await issueSessionForUserId(userId);
    if (!session) return res.status(500).json({ error: 'No se pudo iniciar sesión tras la prueba' });

    res.status(201).json({
      ...session,
      trial: {
        dias: trialDays,
        fecha_renovacion: formatRenewalDateLima(trialDays),
        precio_mensual: Number(plan.precio),
        plan_nombre: plan.nombre,
        tribu_suscripcion_id: trial.tribuSuscripcionId,
      },
      needs_password: true,
    });
  } catch (err) {
    if (createdUserId && !trialActivada) await eliminarUsuarioPruebaFallida(createdUserId);
    const msg = mapCulqiError(err);
    console.error('[tribu-pagos iniciar-prueba]', msg, err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  }
});

router.post('/procesar-pago', tribuAuthMiddleware, async (req, res) => {
  const userId = req.tribuUser.id;
  let enCursoKey = null;
  try {
    const rlIp = limitePagoIp.consumir(ipDe(req));
    if (!rlIp.ok) return responder429(res, rlIp);
    const rlUser = limitePagoUsuario.consumir(String(userId));
    if (!rlUser.ok) return responder429(res, rlUser);

    const {
      suscripcion_id, billing_email: billingEmailRaw, auto_renovacion: autoRenovacionRaw,
      tarjeta_id: tarjetaIdRaw, request_id: requestId, ...rawForm
    } = req.body || {};
    if (!suscripcion_id) return res.status(400).json({ error: 'suscripcion_id requerido' });

    const [[plan]] = await pool.execute('SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = ?', [suscripcion_id]);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const [[estado]] = await pool.execute('SELECT email_verificado FROM tribu_users WHERE id = ? LIMIT 1', [userId]);
    if (estado && estado.email_verificado != null && Number(estado.email_verificado) === 0) {
      return res.status(403).json({
        error: 'Confirma tu correo antes de pagar. Te enviamos un enlace al registrarte; si no lo encuentras, pide uno nuevo.',
        code: 'email_no_verificado',
      });
    }

    enCursoKey = `${userId}:${plan.id}`;
    if (pagosEnCurso.has(enCursoKey)) {
      enCursoKey = null;
      return res.status(409).json({ error: 'Ya hay un pago en curso para este plan. Espera unos segundos.', code: 'pago_en_curso' });
    }
    pagosEnCurso.add(enCursoKey);

    const [[reciente]] = await pool.execute(
      `SELECT culqi_charge_id FROM tribu_culqi_transactions
        WHERE tribu_user_id = ? AND suscripcion_plan_id = ? AND status = 'approved'
          AND created_at >= NOW() - INTERVAL 5 MINUTE
        LIMIT 1`,
      [userId, plan.id]
    );
    if (reciente) {
      return res.status(409).json({
        error: 'Ya registramos un pago aprobado para este plan hace unos minutos. Revisa tu membresía antes de volver a intentarlo.',
        code: 'pago_reciente',
      });
    }

    const cfg = await getCulqiConfig();
    validateCulqiConfig(cfg);

    const tribuUser = await fetchTribuUser(userId);
    const checkout = extractCheckoutPayload(rawForm);
    const wantsAutoRenew = autoRenovacionRaw !== false && autoRenovacionRaw !== '0' && autoRenovacionRaw !== 0;
    const tarjetaId = tarjetaIdRaw ? Number.parseInt(String(tarjetaIdRaw), 10) : null;

    let sourceId = checkout.tokenId;
    let vaultInfo = null, vaultError = null;

    if (tarjetaId) {
      const saved = await getSavedCard(userId, tarjetaId);
      if (!saved) return res.status(400).json({ error: 'Tarjeta guardada no encontrada' });
      sourceId = saved.culqi_card_id;
      vaultInfo = { customerId: saved.culqi_customer_id, cardId: saved.culqi_card_id, cardBrand: saved.culqi_card_brand, lastFour: saved.last_four_digits };
    } else {
      if (!checkout.tokenId) return res.status(400).json({ error: 'Token de Culqi requerido' });
    }

    const identification = checkout.identificationType && checkout.identificationNumber
      ? { type: checkout.identificationType, number: String(checkout.identificationNumber).trim() }
      : null;
    const email = resolvePayerEmail(checkout.email, req.tribuUser.email, cfg.modo, billingEmailRaw);
    const externalRef = buildExternalRef(userId, plan.id);

    if (!tarjetaId && wantsAutoRenew) {
      const vaultResult = await vaultCustomerCardSafe({ secretKey: cfg.secret_key, email, tokenId: checkout.tokenId, user: tribuUser, identification });
      if (vaultResult.ok && vaultResult.vault?.cardId) {
        vaultInfo = vaultResult.vault;
        sourceId = vaultInfo.cardId;
        try { await upsertSavedCard(userId, vaultInfo); } catch (saveErr) { console.error('[tribu-pagos] guardar tarjeta BD', saveErr.message); }
      } else {
        vaultError = vaultResult.errorMessage || 'No se pudo guardar la tarjeta en Culqi';
        console.warn('[tribu-pagos] vault falló:', vaultError);
      }
    }

    const chargeBody = buildChargeBody({ plan, email, user: tribuUser, identification, externalRef, sourceId, description: plan.nombre });
    const idempotencyKey = buildPaymentIdempotencyKey(userId, requestId) || undefined;
    let charge;
    try {
      charge = await createCulqiCharge(cfg.secret_key, chargeBody, idempotencyKey);
    } catch (chargeErr) {
      if (chargeErr.unknownOutcome) {
        console.error(`[tribu-pagos][CONCILIAR] resultado desconocido user=${userId} plan=${plan.id} key=${idempotencyKey || '-'}: ${chargeErr.message}`);
        return res.status(504).json({
          error: 'No pudimos confirmar el pago con Culqi. No lo intentes de nuevo todavía: revisa tu membresía en unos minutos.',
          code: 'resultado_desconocido',
        });
      }
      throw chargeErr;
    }
    const outcome = resolveChargeOutcome(charge);
    let tribuSuscripcionId = null;

    if (!vaultInfo?.cardId) {
      const fromCharge = extractVaultFromCharge(charge);
      if (fromCharge?.cardId) {
        vaultInfo = fromCharge;
        if (wantsAutoRenew) {
          try { await upsertSavedCard(userId, fromCharge); } catch (saveErr) { console.error('[tribu-pagos] guardar tarjeta BD (charge)', saveErr.message); }
        }
      }
    }

    const autoRenovacionActiva = wantsAutoRenew && !!vaultInfo?.cardId;
    const txSource = tarjetaId ? 'api_tarjeta_guardada' : 'api';

    await recordCulqiTransaction(charge, { source: txSource, tribuUserId: userId, planId: plan.id, payerEmail: email });

    if (outcome.status === 'approved') {
      try {
        await savePayerProfile(userId, checkout.identificationType, checkout.identificationNumber, cfg.modo === 'produccion' ? email : null);
      } catch (profileErr) { console.error('[tribu-pagos] perfil de pago', profileErr.message); }
      try {
        tribuSuscripcionId = await activateNewSubscription({
          userId, planId: plan.id, chargeId: outcome.charge_id,
          vigenciaDias: plan.vigencia_dias, customerId: vaultInfo?.customerId || null,
          cardId: vaultInfo?.cardId || null, cardBrand: vaultInfo?.cardBrand || null, autoRenovacion: autoRenovacionActiva,
        });
      } catch (dbErr) {
        console.error(`[tribu-pagos][CONCILIAR] cobro aprobado sin activar user=${userId} plan=${plan.id} charge=${outcome.charge_id}: ${dbErr.message}`);
        return res.status(500).json({ error: 'El pago fue aprobado pero no se pudo activar la suscripción. Contacta soporte.', charge_id: outcome.charge_id, status: outcome.status });
      }
      if (tribuSuscripcionId) {
        await recordCulqiTransaction(charge, { source: txSource, tribuUserId: userId, planId: plan.id, tribuSuscripcionId, payerEmail: email });
      }
    }

    res.json({ ...outcome, auto_renovacion: autoRenovacionActiva, auto_renovacion_solicitada: wantsAutoRenew, tarjeta_guardada: !!vaultInfo?.cardId, vault_error: wantsAutoRenew && !autoRenovacionActiva ? vaultError : null });
  } catch (err) {
    const msg = mapCulqiError(err);
    console.error('[tribu-pagos procesar-pago]', msg, err.status || '', err.payload || err.message || '');
    res.status(httpStatusForError(err)).json({ error: msg });
  } finally {
    if (enCursoKey) pagosEnCurso.delete(enCursoKey);
  }
});

async function handleCronRenovaciones(req, res) {
  if (!validateCronToken(req)) return res.status(401).json({ error: 'Token inválido' });
  let lockConnection = null;
  let lockHeld = false;
  try {
    lockConnection = await pool.getConnection();
    lockHeld = await acquireRenovacionesLock(lockConnection, 2);
    if (!lockHeld) return res.status(429).json({ error: 'Ya en ejecución' });
    const result = await runRenovacionesSuscripciones({ lockConnection });
    res.json(result);
  } catch (err) { console.error('[tribu-pagos cron-renovaciones]', err.message); res.status(500).json({ error: 'Error al procesar renovaciones' }); }
  finally {
    if (lockHeld) await releaseRenovacionesLock(lockConnection);
    if (lockConnection) { try { lockConnection.release(); } catch (_) {} }
  }
}

router.get('/cron-renovaciones', handleCronRenovaciones);
router.post('/cron-renovaciones', handleCronRenovaciones);

router.post('/webhook', async (req, res) => {
  try {
    if (webhookSecretState().failClosed) {
      console.error('[tribu-pagos webhook] CULQI_WEBHOOK_SECRET no configurado en producción: evento rechazado');
      return res.sendStatus(503);
    }
    if (!validateWebhookSignature(req)) { console.warn('[tribu-pagos webhook] firma inválida'); return res.sendStatus(401); }

    const evt = parseWebhookEvent(req.body);
    if (!evt.isChargeSuccess || !evt.chargeId) return res.sendStatus(200);

    const cfg = await getCulqiConfig();
    let charge;
    try {
      charge = await fetchCulqiCharge(cfg.secret_key, evt.chargeId);
    } catch (fetchErr) {
      if (Number(fetchErr.status) === 404) {
        console.warn('[tribu-pagos webhook] cargo inexistente en Culqi:', evt.chargeId);
        return res.sendStatus(200);
      }
      throw fetchErr;
    }
    if (!charge || charge.id !== evt.chargeId) {
      console.warn('[tribu-pagos webhook] respuesta de Culqi no coincide con el cargo', evt.chargeId);
      return res.sendStatus(200);
    }
    if (!String(charge?.metadata?.external_reference || '').startsWith('tribu-')) return res.sendStatus(200);

    await recordCulqiTransaction(charge, { source: 'webhook', payerEmail: charge.email || null });
    const applied = await applyApprovedCharge(charge);
    if (applied?.rejected) {
      console.warn(`[tribu-pagos webhook] cargo ${evt.chargeId} no aplicado: ${applied.rejected}`);
      return res.sendStatus(200);
    }
    if (applied?.tribuSuscripcionId) {
      await recordCulqiTransaction(charge, { source: 'webhook', tribuSuscripcionId: applied.tribuSuscripcionId, payerEmail: charge.email || null });
    }
    res.sendStatus(200);
  } catch (err) { console.error('[tribu-pagos webhook]', err.message); res.sendStatus(500); }
});

router.get('/transacciones', authMiddleware, requireAdmin, requireAcceso('config'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status ? String(req.query.status).slice(0, 20) : null;
    const where = status ? 'WHERE t.status = ?' : '';
    const params = status ? [status, limit, offset] : [limit, offset];

    const [rows] = await pool.query(
      `SELECT t.id, t.culqi_charge_id, t.tribu_user_id, t.suscripcion_plan_id,
              t.tribu_suscripcion_id, t.amount_cents, t.currency_code, t.status,
              t.outcome_type, t.outcome_code, t.merchant_message, t.user_message,
              t.external_reference, t.event_source, t.card_brand, t.card_last_four,
              t.payer_email_masked, t.culqi_created_at, t.created_at,
              u.email AS tribu_user_email, s.nombre AS plan_nombre
       FROM tribu_culqi_transactions t
       LEFT JOIN tribu_users u ON u.id = t.tribu_user_id
       LEFT JOIN suscripciones s ON s.id = t.suscripcion_plan_id
       ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM tribu_culqi_transactions t ${where}`, status ? [status] : []
    );
    res.json({ total, limit, offset, transacciones: rows });
  } catch (err) { console.error('[tribu-pagos transacciones]', err.message); res.status(500).json({ error: 'No se pudo listar transacciones' }); }
});

module.exports = router;
