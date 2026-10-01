/**
 * fix-foto-urls.js
 * Reemplaza URLs de fotos con origen incorrecto (localhost o relativas)
 * por la URL de producción en todas las tablas que tienen foto_url.
 *
 * Uso: node scripts/fix-foto-urls.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/db');

const OLD_PREFIXES = [
  'http://localhost:3002/latribu/uploads/',
  'http://localhost:3002/uploads/',
  '/latribu/uploads/',
  '/uploads/',
];
const NEW_PREFIX = 'https://vhm.com.pe/latribu/uploads/';

const TARGETS = [
  { table: 'tribu_users',       col: 'foto_url' },
  { table: 'testimonios',       col: 'foto_url' },
  { table: 'tribu_posts',       col: 'foto_url' },
  { table: 'plantilla_mensajes', col: 'foto_url' },
];

async function run() {
  let total = 0;
  for (const { table, col } of TARGETS) {
    for (const old of OLD_PREFIXES) {
      const [res] = await pool.execute(
        `UPDATE \`${table}\` SET \`${col}\` = CONCAT(?, SUBSTRING(\`${col}\`, ?))
         WHERE \`${col}\` LIKE ?`,
        [NEW_PREFIX, old.length + 1, `${old}%`]
      );
      if (res.affectedRows > 0) {
        console.log(`  ${table}.${col}: ${res.affectedRows} fila(s) — "${old}" → "${NEW_PREFIX}"`);
        total += res.affectedRows;
      }
    }
  }
  console.log(`\nTotal actualizado: ${total} fila(s)`);
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
