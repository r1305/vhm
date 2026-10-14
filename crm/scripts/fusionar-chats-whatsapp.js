#!/usr/bin/env node
'use strict';

/**
 * Fusiona conversaciones de WhatsApp duplicadas (mismos últimos 9 dígitos y chats @lid).
 * Uso:
 *   node scripts/fusionar-chats-whatsapp.js            → simula dentro de una transacción y hace ROLLBACK
 *   node scripts/fusionar-chats-whatsapp.js --ejecutar → aplica los cambios (COMMIT)
 */

require('dotenv').config();
const pool = require('../lib/db');
const { fusionarChatsWhatsappTelefono, fusionarChatsWhatsappLid } = require('../schema');

(async () => {
  const ejecutar = process.argv.includes('--ejecutar');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const porTelefono = await fusionarChatsWhatsappTelefono(conn);
    const porLid = await fusionarChatsWhatsappLid(conn);
    if (ejecutar) await conn.commit();
    else await conn.rollback();
    console.log(`Fusionadas por teléfono: ${porTelefono} · por @lid: ${porLid}`);
    console.log(ejecutar ? 'Cambios aplicados.' : 'Simulación: sin cambios. Usa --ejecutar para aplicar.');
  } catch (err) {
    await conn.rollback();
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
