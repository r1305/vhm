/**
 * Crea el primer Super Admin para La Tribu.
 * Uso: ADMIN_PASSWORD=... node scripts/setup-admin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const { ensureSchema } = require('../src/schema');

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('[setup] Falta ADMIN_PASSWORD: definirla en latribu/.env (solo para este script; luego borrarla)');
    process.exit(1);
  }
  const nombre = process.env.ADMIN_NOMBRE || 'Super Admin';
  const email = process.env.ADMIN_EMAIL || 'admin@vhm.com.pe';

  console.log('[setup] Asegurando esquema...');
  await ensureSchema();

  const [existing] = await pool.execute('SELECT id FROM tribu_admins WHERE username = ? LIMIT 1', [username]);
  if (existing.length) {
    console.log(`[setup] El usuario "${username}" ya existe. Nada que hacer.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute(
    'INSERT INTO tribu_admins (username, password, nombre, email, rol, es_protegido) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hash, nombre, email, 'SUPER_ADMIN', 1]
  );
  console.log(`[setup] Super Admin creado: id=${result.insertId}, username="${username}"`);
  console.log('[setup] Contraseña tomada de ADMIN_PASSWORD (no se muestra). Borrar ADMIN_PASSWORD del .env.');
  process.exit(0);
}

main().catch(err => { console.error('[setup] Error:', err.message); process.exit(1); });
