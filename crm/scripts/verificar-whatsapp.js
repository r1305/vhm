#!/usr/bin/env node
'use strict';

/**
 * Verifica integración CRM ↔ OpenWA (config, webhook, sesión, LID).
 * Uso: node scripts/verificar-whatsapp.js
 */

const pool = require('../lib/db');
const { loadOpenwaConfigFromDB, isOpenwaConfigured } = require('../lib/openwa');

async function main() {
  const issues = [];
  const ok = [];

  const [cfgRows] = await pool.execute(
    "SELECT clave, valor FROM configuracion WHERE clave LIKE 'openwa%'"
  );
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.clave, r.valor || '']));

  console.log('=== CRM (base de datos) ===');
  console.log('openwa_url:', cfg.openwa_url || '(vacío)');
  console.log('openwa_session:', cfg.openwa_session || '(vacío)');
  console.log('openwa_api_key:', cfg.openwa_api_key ? `${cfg.openwa_api_key.slice(0, 12)}...` : '(vacío)');
  console.log('openwa_webhook_token:', cfg.openwa_webhook_token ? 'configurado' : '(vacío)');

  if (!cfg.openwa_url) issues.push('Falta openwa_url en Integraciones');
  if (!cfg.openwa_api_key) issues.push('Falta openwa_api_key en Integraciones');
  if (!cfg.openwa_session) issues.push('Falta openwa_session en Integraciones');
  if (!cfg.openwa_webhook_token) issues.push('Falta openwa_webhook_token en Integraciones');

  const expectedWebhook = 'https://vhm.com.pe/crm/api/whatsapp/webhook';
  if (cfg.openwa_url && !cfg.openwa_url.includes('vhm.com.pe')) {
    issues.push(`openwa_url inesperada: ${cfg.openwa_url}`);
  }

  await loadOpenwaConfigFromDB();
  if (!isOpenwaConfigured()) {
    issues.push('isOpenwaConfigured() = false');
  } else {
    ok.push('CRM: OpenWA configurado en memoria');
  }

  const baseUrl = (process.env.OPENWA_URL || '').replace(/\/$/, '');
  const apiKey = process.env.OPENWA_API_KEY || '';
  const sessionId = process.env.OPENWA_SESSION || '';
  const webhookToken = process.env.OPENWA_WEBHOOK_TOKEN || '';

  console.log('\n=== OpenWA API ===');
  const headers = { 'X-API-Key': apiKey };

  const statusRes = await fetch(`${baseUrl}/api/status`, { headers });
  if (!statusRes.ok) {
    issues.push(`OpenWA /api/status → HTTP ${statusRes.status}`);
  } else {
    const status = await statusRes.json();
    console.log('status:', JSON.stringify(status));
    ok.push(`OpenWA activo (${status.sessions} sesiones, ${status.messages} msgs en SQLite)`);
  }

  const healthRes = await fetch(`${baseUrl}/api/health`);
  const health = healthRes.ok ? await healthRes.json() : null;
  if (health) {
    console.log('health:', JSON.stringify(health));
    if (health.sessionsReady < 1) issues.push('Ninguna sesión WhatsApp en estado ready');
    else ok.push(`${health.sessionsReady} sesión(es) ready`);
  }

  console.log('\n=== Webhooks de sesión OpenWA ===');
  const sessionWebhooks = await fetch(`${baseUrl}/api/webhooks`, { headers })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);

  if (!Array.isArray(sessionWebhooks) || !sessionWebhooks.length) {
    issues.push('No hay webhooks de sesión registrados en OpenWA');
  } else {
    for (const wh of sessionWebhooks) {
      console.log(`- ${wh.id}`);
      console.log('  url:', wh.url || '(vacío)');
      console.log('  events:', JSON.stringify(wh.events || []));
      console.log('  active:', wh.active);

      if (!wh.url?.includes('/crm/api/whatsapp/webhook')) {
        issues.push(`Webhook URL incorrecta: ${wh.url}`);
      } else {
        ok.push('Webhook URL correcta');
      }

      const events = wh.events || [];
      const receivesIncoming = events.includes('*')
        || events.some((e) => /message\.?received/i.test(e));
      const receivesSent = events.includes('*')
        || events.some((e) => /message\.?sent/i.test(e));

      if (!receivesIncoming) {
        issues.push(`Webhook sin message.received: ${JSON.stringify(events)}`);
      } else {
        ok.push('Webhook suscrito a message.received');
      }
      if (!receivesSent) {
        issues.push('Webhook sin message.sent — no verás mensajes enviados desde WhatsApp Web');
      } else {
        ok.push('Webhook suscrito a message.sent (WhatsApp Web)');
      }
    }
  }

  const configRes = await fetch(`${baseUrl}/api/webhooks/config`, { headers });
  if (configRes.ok) {
    const globalWh = await configRes.json();
    if (globalWh.url) {
      console.log('\nWebhook global (legacy):', globalWh.url);
    }
  }

  {
    const [logRes] = await Promise.all([
      fetch(`${baseUrl}/api/webhooks/log`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ]);
    const logs = Array.isArray(logRes) ? logRes : [];
    const recent = logs.slice(0, 15);
    console.log('\n=== Últimos webhooks (OpenWA log) ===');
    if (!recent.length) {
      console.log('(sin registros)');
    } else {
      for (const l of recent) {
        console.log(`${l.created_at} | ${l.success ? 'OK' : 'FAIL'} | ${l.event} | ${l.response}`);
      }
      const fails = recent.filter((l) => !l.success);
      const msgFails = fails.filter((l) => /message/i.test(l.event));
      if (msgFails.length) {
        issues.push(`${msgFails.length} webhook(s) de mensaje fallaron recientemente`);
      }
      const authFails = fails.filter((l) => String(l.response).includes('401'));
      if (authFails.length) {
        issues.push('Webhooks rechazados con HTTP 401 — token CRM ≠ OpenWA');
      }
      const sentLogs = logs.filter((l) => /message\.?sent/i.test(l.event));
      if (!sentLogs.length) {
        console.log('(aviso) Aún no hay message.sent en el log — normal hasta enviar desde WhatsApp Web');
      }
    }
  }

  console.log('\n=== Prueba webhook CRM ===');
  const testPayload = {
    event: 'message:received',
    data: {
      chatId: 'test@lid',
      remoteJid: 'test@lid',
      lidChatId: 'test@lid',
      body: '__verificacion_crm__',
      messageId: `verify_${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000),
      messageType: 'text',
    },
  };

  const whRes = await fetch(expectedWebhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${webhookToken}`,
    },
    body: JSON.stringify(testPayload),
  });
  const whBody = await whRes.text();
  console.log(`POST ${expectedWebhook} → ${whRes.status}`);
  console.log('body:', whBody.slice(0, 200));
  if (whRes.status === 401) {
    issues.push('CRM rechaza webhook con 401 — token no coincide');
  } else if (whRes.ok) {
    ok.push('CRM acepta webhook con token actual');
    await pool.execute(
      "DELETE FROM wa_mensajes WHERE cuerpo = '__verificacion_crm__'"
    ).catch(() => {});
    await pool.execute(
      "DELETE FROM wa_conversaciones WHERE chat_id = 'test@lid'"
    ).catch(() => {});
  } else {
    issues.push(`CRM webhook respondió ${whRes.status}: ${whBody.slice(0, 100)}`);
  }

  console.log('\n=== LID resolve (OpenWA) ===');
  const lidRes = await fetch(`${baseUrl}/api/chats/lid/resolve?lid=47571124936897@lid`, { headers });
  if (lidRes.ok) {
    const lid = await lidRes.json();
    console.log('ejemplo LID:', JSON.stringify(lid));
    if (lid.phone) ok.push('lid_map tiene mapeo de ejemplo');
    else issues.push('lid_map vacío para LID de prueba (47571124936897@lid)');
  }

  const [[{ convs }]] = await pool.execute('SELECT COUNT(*) AS convs FROM wa_conversaciones');
  const [[{ msgs }]] = await pool.execute('SELECT COUNT(*) AS msgs FROM wa_mensajes');
  const [[{ orphans }]] = await pool.execute(
    `SELECT COUNT(*) AS orphans FROM wa_conversaciones
     WHERE chat_id LIKE '%@lid' AND (phone IS NULL OR phone = '')`
  );
  console.log('\n=== CRM WhatsApp DB ===');
  console.log(`Conversaciones: ${convs}, Mensajes: ${msgs}, Huérfanas @lid: ${orphans}`);

  console.log('\n=== Commits pendientes de desplegar ===');
  console.log('CRM: dff7397 (LID routing + sync WA Web)');
  console.log('OpenWA: dd2bc15 (webhook chatId/remoteJid)');
  console.log('OpenWA: 51c8665+ (purge-messages API, si aplica)');

  console.log('\n========================================');
  if (issues.length) {
    console.log('PROBLEMAS (' + issues.length + '):');
    issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
  }
  if (ok.length) {
    console.log('\nOK (' + ok.length + '):');
    ok.forEach((i) => console.log(`  ✓ ${i}`));
  }
  console.log('\nDespliegue: bash ~/public_html/redeploy.sh');
  process.exit(issues.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
