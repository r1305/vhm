/**
 * Uso: node crm/reset-admin.js
 * Crea o actualiza el usuario CRM con la contraseña $CRM$2026
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const pool   = require('./lib/db');

async function main() {
  const hash = await bcrypt.hash('$CRM$2026$', 12);

  // Agregar columna username si no existe (por si la tabla fue creada antes)
  try {
    await pool.execute(`ALTER TABLE terapeutas ADD COLUMN username VARCHAR(50) UNIQUE AFTER apellido`);
    console.log('[reset-admin] Columna username agregada');
  } catch (e) {
    if (!e.message.includes('Duplicate column')) console.log('[reset-admin] username ya existe, ok');
  }

  // Verificar si ya existe por email o username CRM
  const [[existing]] = await pool.execute(
    `SELECT id FROM terapeutas WHERE username = 'CRM' OR email = 'admin@vhm.com.pe' LIMIT 1`
  );

  if (existing) {
    await pool.execute(
      `UPDATE terapeutas SET username='CRM', nombre='CRM', apellido='Admin',
       password=?, rol='superadmin', activo=1 WHERE id=?`,
      [hash, existing.id]
    );
    console.log('[reset-admin] Usuario CRM actualizado');
  } else {
    await pool.execute(
      `INSERT INTO terapeutas (nombre, apellido, username, email, password, rol)
       VALUES ('CRM', 'Admin', 'CRM', 'admin@vhm.com.pe', ?, 'superadmin')`,
      [hash]
    );
    console.log('[reset-admin] Usuario CRM creado');
  }

  console.log('Usuario: CRM');
  console.log('Contraseña: $CRM$2026$');
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
