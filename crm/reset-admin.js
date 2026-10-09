/**
 * Uso: CRM_ADMIN_INITIAL_PASSWORD=... node crm/reset-admin.js
 *   o: node crm/reset-admin.js '<contraseña>'
 * Crea o actualiza el usuario CRM (superadmin) con esa contraseña.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const pool   = require('./lib/db');

async function main() {
  const password = process.argv[2] || process.env.CRM_ADMIN_INITIAL_PASSWORD;
  if (!password) {
    console.error('[reset-admin] Falta la contraseña: definir CRM_ADMIN_INITIAL_PASSWORD en crm/.env o pasarla como argumento (node crm/reset-admin.js <contraseña>)');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);

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
  console.log('[reset-admin] Contraseña establecida (no se muestra). Borrar CRM_ADMIN_INITIAL_PASSWORD del .env si se usó.');
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
