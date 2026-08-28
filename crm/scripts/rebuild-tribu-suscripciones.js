#!/usr/bin/env node
/**
 * Uso (desde crm/): node scripts/rebuild-tribu-suscripciones.js
 * Trunca tribu_suscripciones y asigna plan S/ 89.90 por 1 año a cada tribu_users.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { rebuildAllTribuSubscriptions, isConfigured } = require('../lib/tribuProvision');

(async () => {
  if (!isConfigured()) {
    console.error('TRIBU_DB_NAME no está configurado en .env');
    process.exit(1);
  }
  const result = await rebuildAllTribuSubscriptions();
  console.log(`OK: ${result.suscripciones} suscripción(es) creada(s) para ${result.usuarios} usuario(s) Tribu.`);
  process.exit(0);
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
