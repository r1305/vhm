#!/usr/bin/env node
'use strict';

/**
 * Borra todos los chats y mensajes de WhatsApp del CRM.
 * Uso: node scripts/limpiar-whatsapp.js
 */

const pool = require('../lib/db');

(async () => {
  const [[{ mensajes }]] = await pool.execute('SELECT COUNT(*) AS mensajes FROM wa_mensajes');
  const [[{ conversaciones }]] = await pool.execute('SELECT COUNT(*) AS conversaciones FROM wa_conversaciones');

  console.log(`Antes: ${conversaciones} conversaciones, ${mensajes} mensajes`);

  if (conversaciones === 0 && mensajes === 0) {
    console.log('Nada que limpiar.');
    process.exit(0);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM wa_mensajes');
    await conn.execute('DELETE FROM wa_conversaciones');
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [[{ mensajes: m2 }]] = await pool.execute('SELECT COUNT(*) AS mensajes FROM wa_mensajes');
  const [[{ conversaciones: c2 }]] = await pool.execute('SELECT COUNT(*) AS conversaciones FROM wa_conversaciones');

  console.log(`Después: ${c2} conversaciones, ${m2} mensajes`);
  console.log('Listo. Chats de WhatsApp eliminados.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
