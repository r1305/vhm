/**
 * Uso: node scripts/clean-paquetes-paciente.js <email>
 * Elimina todos los paquetes adquiridos (y cuotas) de un paciente por email.
 */
require('dotenv').config();
const pool = require('../lib/db');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: node scripts/clean-paquetes-paciente.js <email>');
    process.exit(1);
  }

  const [[paciente]] = await pool.execute(
    'SELECT id, nombre, apellido, email FROM pacientes WHERE email = ? LIMIT 1',
    [email]
  );
  if (!paciente) {
    console.error(`No se encontró paciente con email: ${email}`);
    process.exit(1);
  }

  const [paquetes] = await pool.execute(
    'SELECT id, nombre FROM paciente_paquetes WHERE paciente_id = ?',
    [paciente.id]
  );

  if (!paquetes.length) {
    console.log(`Sin paquetes para ${paciente.nombre} ${paciente.apellido} (${email})`);
    process.exit(0);
  }

  const ids = paquetes.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');

  await pool.execute(
    `UPDATE citas SET paciente_paquete_id = NULL WHERE paciente_paquete_id IN (${placeholders})`,
    ids
  );
  const [del] = await pool.execute(
    `DELETE FROM paciente_paquetes WHERE id IN (${placeholders})`,
    ids
  );

  console.log(`Paciente: ${paciente.nombre} ${paciente.apellido} (${email})`);
  console.log(`Paquetes eliminados: ${del.affectedRows}`);
  paquetes.forEach((p) => console.log(`  - ${p.nombre} (id ${p.id})`));
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
