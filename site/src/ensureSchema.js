const pool = require('./db');
const { ensureAccesosSchema, backfillAccesos } = require('./lib/siteAccesos');

let readyPromise = null;

// Auto-migración del esquema del sitio.
// Memoiza la promesa: se ejecuta una sola vez y todas las rutas pueden
// esperarla. Si falla, limpia la caché para reintentar en la próxima llamada.
function ensureVideoSchema() {
  if (!readyPromise) {
    readyPromise = crearEsquema().catch((err) => {
      readyPromise = null; // permite reintentar en la siguiente petición
      throw err;
    });
  }
  return readyPromise;
}

async function crearEsquema() {
  await ensureAccesosSchema();
  await backfillAccesos();

  // ── Agregar columna creado_por a tablas existentes (migración) ──
  const tablasConCreador = ['testimonios'];
  for (const tabla of tablasConCreador) {
    await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN creado_por INT NULL`).catch(() => {});
  }
  // Columna respondido_por en reclamos (quién respondió)
  await pool.query('ALTER TABLE reclamos ADD COLUMN respondido_por INT NULL').catch(() => {});
}

module.exports = { ensureVideoSchema };
