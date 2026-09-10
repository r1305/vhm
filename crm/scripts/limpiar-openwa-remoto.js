#!/usr/bin/env node
'use strict';

/**
 * Limpia mensajes en OpenWA de producción vía API.
 * Uso: node scripts/limpiar-openwa-remoto.js
 */

const pool = require('../lib/db');
const { loadOpenwaConfigFromDB } = require('../lib/openwa');

async function main() {
  await loadOpenwaConfigFromDB();
  const baseUrl = (process.env.OPENWA_URL || '').replace(/\/$/, '');
  const apiKey = process.env.OPENWA_API_KEY || '';
  if (!baseUrl || !apiKey) {
    throw new Error('OpenWA no configurado en Integraciones');
  }

  const statusRes = await fetch(`${baseUrl}/api/status`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!statusRes.ok) {
    throw new Error(`OpenWA status ${statusRes.status}`);
  }
  const status = await statusRes.json();
  console.log(`Antes: ${status.messages} mensajes en OpenWA`);

  if (!status.messages) {
    console.log('Nada que limpiar.');
    return;
  }

  const purgeRes = await fetch(`${baseUrl}/api/purge-messages`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const body = await purgeRes.json().catch(() => ({}));
  if (!purgeRes.ok) {
    throw new Error(body.error || body.message || `OpenWA purge ${purgeRes.status}`);
  }

  console.log(`Después: ${body.after} mensajes (${body.mediaFiles || 0} archivos media eliminados)`);
  console.log('Listo.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
