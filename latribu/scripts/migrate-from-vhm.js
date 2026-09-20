/**
 * Migración de datos: ssfdgwtm_vhm → ssfdgwtm_tribu
 * MOVER: videos, video_categorias, video_landing, tribu_eventos,
 *        plantilla_eventos, plantilla_mensajes, encuestas+relacionadas,
 *        tribu_users, tribu_suscripciones, suscripciones, config_suscripciones,
 *        config_culqi, tribu_payer_profiles, tribu_saved_cards,
 *        tribu_culqi_payment_events, tribu_culqi_transactions, tribu_access
 * COPIAR: testimonios, testimonios_config
 */

const mysql = require('mysql2/promise');

const VHM = { host: 'hd-europe2722.banahosting.com', user: 'ssfdgwtm_vhm',   password: '$VHM$2026$',   database: 'ssfdgwtm_vhm' };
const TRB = { host: 'hd-europe2722.banahosting.com', user: 'ssfdgwtm_tribu', password: '$Tribu$2026$', database: 'ssfdgwtm_tribu' };

// Orden respeta FK: padres antes que hijos
const MOVE_TABLES = [
  // config / standalone
  'tribu_access',
  'config_culqi',
  'config_suscripciones',
  'suscripciones',
  // videos
  'video_categorias',
  'videos',
  'video_landing',
  // eventos / plantillas
  'tribu_eventos',
  'plantilla_eventos',
  'plantilla_mensajes',
  // encuestas
  'encuestas',
  'encuesta_preguntas',
  'encuesta_opciones',
  'encuesta_respuestas',
  'encuesta_respuesta_detalle',
  // tribu users & pagos
  'tribu_users',
  'tribu_payer_profiles',
  'tribu_saved_cards',
  'tribu_suscripciones',
  'tribu_culqi_payment_events',
  'tribu_culqi_transactions',
];

const COPY_TABLES = ['testimonios_config', 'testimonios'];

async function copyTable(vhm, trb, table, truncateFirst = true) {
  const [rows] = await vhm.query(`SELECT * FROM \`${table}\``);
  if (rows.length === 0) { console.log(`  ${table}: vacía, omitida`); return; }

  if (truncateFirst) {
    await trb.query(`SET FOREIGN_KEY_CHECKS=0`);
    await trb.query(`TRUNCATE TABLE \`${table}\``);
    await trb.query(`SET FOREIGN_KEY_CHECKS=1`);
  }

  const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
  const placeholders = Object.keys(rows[0]).map(() => '?').join(', ');

  for (const row of rows) {
    const values = Object.values(row).map(v =>
      (v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date))
        ? JSON.stringify(v)
        : v
    );
    await trb.query(
      `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
      values
    );
  }
  console.log(`  ${table}: ${rows.length} filas copiadas`);
}

async function deleteFromVhm(vhm, tables) {
  await vhm.query(`SET FOREIGN_KEY_CHECKS=0`);
  // Borrar en orden inverso (hijos antes que padres)
  for (const table of [...tables].reverse()) {
    try {
      await vhm.query(`DELETE FROM \`${table}\``);
      console.log(`  ${table}: borrada de vhm`);
    } catch (e) {
      console.log(`  ${table}: no se pudo borrar — ${e.message}`);
    }
  }
  await vhm.query(`SET FOREIGN_KEY_CHECKS=1`);
}

async function main() {
  const vhm = await mysql.createConnection(VHM);
  const trb = await mysql.createConnection(TRB);

  try {
    console.log('\n=== COPIANDO (testimonios) ===');
    for (const t of COPY_TABLES) await copyTable(vhm, trb, t);

    console.log('\n=== MOVIENDO (copiar → borrar de vhm) ===');
    for (const t of MOVE_TABLES) await copyTable(vhm, trb, t);

    console.log('\n=== BORRANDO de vhm las tablas movidas ===');
    await deleteFromVhm(vhm, MOVE_TABLES);

    console.log('\n✓ Migración completada.\n');
  } finally {
    await vhm.end();
    await trb.end();
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
