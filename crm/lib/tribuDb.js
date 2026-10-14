const env = require('./env');
const mysql = require('mysql2/promise');

const host = env('TRIBU_DB_HOST') || env('DB_HOST') || '127.0.0.1';
const user = env('TRIBU_DB_USER') || env('DB_USER') || 'root';
const password = env('TRIBU_DB_PASSWORD') ?? env('DB_PASSWORD') ?? '';
const database = env('TRIBU_DB_NAME') || '';

let pool = null;

function isConfigured() {
  return Boolean(database);
}

function getPool() {
  if (!isConfigured()) {
    throw new Error('TRIBU_DB_NAME no configurado en el CRM');
  }
  if (!pool) {
    pool = mysql.createPool({
      host,
      port: parseInt(env('TRIBU_DB_PORT') || env('DB_PORT') || '3306', 10),
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: parseInt(env('TRIBU_DB_POOL_MAX') || '3', 10),
      timezone: '-05:00',
    });
  }
  return pool;
}

async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

module.exports = { getPool, isConfigured, closePool };
