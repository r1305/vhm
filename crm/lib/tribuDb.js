require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const host = process.env.TRIBU_DB_HOST || process.env.DB_HOST || '127.0.0.1';
const user = process.env.TRIBU_DB_USER || process.env.DB_USER || 'root';
const password = process.env.TRIBU_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '';
const database = process.env.TRIBU_DB_NAME || '';

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
      port: parseInt(process.env.TRIBU_DB_PORT || process.env.DB_PORT || '3306', 10),
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: parseInt(process.env.TRIBU_DB_POOL_MAX || '3', 10),
      timezone: '-05:00',
    });
  }
  return pool;
}

module.exports = { getPool, isConfigured };
