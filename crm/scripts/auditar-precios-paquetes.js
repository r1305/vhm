/**
 * Audita la relación pacientes ↔ paquetes para el Reporte Financiero.
 *
 * Uso:
 *   node scripts/auditar-precios-paquetes.js          → solo muestra los problemas
 *   node scripts/auditar-precios-paquetes.js --fix    → además los repara
 *
 * Revisa:
 *   1. Paquetes del catálogo sin precio (no se pueden vender correctamente).
 *   2. Paquetes asignados a pacientes sin precio, sin cuotas o con cuotas que
 *      no suman el precio (no aparecen bien en "Vendido / Cobrado / Por cobrar").
 *   3. Pacientes que solo tienen sesiones del sistema antiguo (paciente_sesiones)
 *      y ningún paquete: no tienen precio y no aparecen en el reporte.
 */
require('dotenv').config();
const pool = require('../lib/db');
const {
  findPaquetesPrecioInconsistentes,
  repairPaquetesPrecioInconsistente,
} = require('../lib/paquetesPaciente');

const ETIQUETA = {
  sin_precio: 'Precio 0 (se toma del catálogo)',
  sin_cuotas: 'Sin cuotas (se generan)',
  cuotas_descuadre: 'Cuotas no suman el precio (se recalculan)',
  catalogo_sin_precio: 'Sin precio ni en el catálogo → REVISAR A MANO',
};

const sol = (n) => `S/ ${Number(n || 0).toFixed(2)}`;

async function main() {
  const fix = process.argv.includes('--fix');

  const [catSinPrecio] = await pool.execute(
    'SELECT id, nombre, activo FROM paquetes_catalogo WHERE precio <= 0 ORDER BY nombre'
  );
  console.log(`\n1) Paquetes del catálogo sin precio: ${catSinPrecio.length}`);
  catSinPrecio.forEach((c) => console.log(`   - #${c.id} ${c.nombre}${c.activo ? '' : ' (inactivo)'}`));

  const problemas = await findPaquetesPrecioInconsistentes();
  console.log(`\n2) Paquetes de pacientes con precio/cuotas inconsistentes: ${problemas.length}`);
  problemas.forEach((r) => {
    console.log(
      `   - #${r.id} ${r.paciente_nombre || ''} ${r.paciente_apellido || ''} · ${r.nombre}` +
      ` · precio ${sol(r.precio)} · catálogo ${sol(r.catalogo_precio)}` +
      ` · ${r.n_cuotas} cuota(s) = ${sol(r.suma_cuotas)} → ${ETIQUETA[r.problema]}`
    );
  });

  const [legacy] = await pool.execute(
    `SELECT p.id, p.nombre, p.apellido, SUM(ps.sesiones) AS sesiones
     FROM pacientes p
     INNER JOIN paciente_sesiones ps ON ps.paciente_id = p.id
     WHERE NOT EXISTS (SELECT 1 FROM paciente_paquetes pp WHERE pp.paciente_id = p.id)
     GROUP BY p.id, p.nombre, p.apellido
     HAVING sesiones > 0
     ORDER BY p.apellido, p.nombre`
  );
  console.log(`\n3) Pacientes solo con sesiones antiguas (sin paquete, sin precio): ${legacy.length}`);
  legacy.forEach((p) => console.log(`   - #${p.id} ${p.nombre} ${p.apellido} · ${p.sesiones} sesiones`));
  if (legacy.length) {
    console.log('   → Asígnales el paquete correspondiente desde Pacientes para que figuren en el reporte.');
  }

  if (fix) {
    const n = await repairPaquetesPrecioInconsistente();
    console.log(`\n✔ Reparados ${n} paquete(s).`);
    const pendientes = (await findPaquetesPrecioInconsistentes()).length;
    if (pendientes) console.log(`⚠ Quedan ${pendientes} que requieren poner precio a mano (catálogo sin precio).`);
  } else if (problemas.length) {
    console.log('\nEjecuta con --fix para reparar automáticamente (o simplemente abre el Reporte Financiero).');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
