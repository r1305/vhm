require('dotenv').config();
const path = require('path');
// Garantizar que se carga el .env de esta carpeta
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'vhm_crm',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_MAX || '5', 10),
  maxIdle:  parseInt(process.env.DB_POOL_IDLE_MAX || '2', 10),
  idleTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: '-05:00',
});

module.exports = pool;
