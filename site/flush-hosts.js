// Ejecutar: node flush-hosts.js
// Requiere DB_ROOT_USER y DB_ROOT_PASSWORD en .env (o las variables de entorno del sistema)
// Si el usuario normal tiene privilegios RELOAD, usa DB_USER/DB_PASSWORD directamente.
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_ROOT_USER || process.env.DB_USER,
    password: process.env.DB_ROOT_PASSWORD || process.env.DB_PASSWORD,
  });

  try {
    await conn.query('FLUSH HOSTS');
    console.log('✅ FLUSH HOSTS ejecutado correctamente. La IP ha sido desbloqueada.');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
