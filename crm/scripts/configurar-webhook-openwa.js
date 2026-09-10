#!/usr/bin/env node
'use strict';

/**
 * Asegura que el webhook de sesión OpenWA incluya message.sent (WhatsApp Web).
 * Uso: node scripts/configurar-webhook-openwa.js
 */

const { loadOpenwaConfigFromDB } = require('../lib/openwa');

const REQUIRED_EVENTS = [
  'message.received',
  'message.sent',
  'message.ack',
  'message.revoked',
];

const EXPECTED_PATH = '/crm/api/whatsapp/webhook';

async function main() {
  await loadOpenwaConfigFromDB();
  const baseUrl = (process.env.OPENWA_URL || '').replace(/\/$/, '');
  const apiKey = process.env.OPENWA_API_KEY || '';
  const sessionId = process.env.OPENWA_SESSION || '';
  const webhookToken = process.env.OPENWA_WEBHOOK_TOKEN || '';
  const webhookUrl = `https://vhm.com.pe${EXPECTED_PATH}`;

  if (!baseUrl || !apiKey || !sessionId) {
    throw new Error('OpenWA no configurado en Integraciones');
  }

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  };

  const webhooks = await fetch(`${baseUrl}/api/webhooks`, { headers }).then((r) => r.json());
  const mine = (webhooks || []).filter((w) => w.sessionId === sessionId);

  if (!mine.length) {
    console.log('Creando webhook de sesión...');
    const created = await fetch(`${baseUrl}/api/sessions/${sessionId}/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: webhookUrl,
        token: webhookToken,
        events: REQUIRED_EVENTS,
      }),
    });
    const body = await created.json();
    if (!created.ok) throw new Error(body.message || body.error || `HTTP ${created.status}`);
    console.log('Creado:', body.id, body.events);
    return;
  }

  for (const wh of mine) {
    const needsUpdate = !REQUIRED_EVENTS.every((e) => (wh.events || []).includes(e))
      || !wh.url?.includes(EXPECTED_PATH);
    if (!needsUpdate) {
      console.log(`Webhook ${wh.id} ya está correcto:`, wh.events);
      continue;
    }
    const updated = await fetch(`${baseUrl}/api/sessions/${sessionId}/webhooks/${wh.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        url: webhookUrl,
        token: webhookToken,
        events: REQUIRED_EVENTS,
        active: true,
      }),
    });
    const body = await updated.json();
    if (!updated.ok) throw new Error(body.message || body.error || `HTTP ${updated.status}`);
    console.log(`Webhook ${wh.id} actualizado:`, body.events);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
