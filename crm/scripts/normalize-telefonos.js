#!/usr/bin/env node
'use strict';

const db = require('../lib/db');

function normalizar(tel) {
  if (!tel) return tel;
  return tel.replace(/[\s+()\-]/g, '');
}

(async () => {
  const [rows] = await db.query('SELECT id, telefono FROM pacientes WHERE telefono IS NOT NULL AND telefono != ""');
  console.log(`Pacientes con teléfono: ${rows.length}`);

  let actualizados = 0;
  for (const row of rows) {
    const norm = normalizar(row.telefono);
    if (norm !== row.telefono) {
      await db.query('UPDATE pacientes SET telefono = ? WHERE id = ?', [norm, row.id]);
      console.log(`  [${row.id}] "${row.telefono}" → "${norm}"`);
      actualizados++;
    }
  }

  console.log(`\nListo. ${actualizados} teléfonos actualizados.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
