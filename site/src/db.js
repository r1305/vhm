require('dotenv').config();
const mysql = require('mysql2/promise');
const { siteEnv } = require('../lib/siteEnv');

const pool = mysql.createPool({
  host: siteEnv('DB_HOST'),
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: siteEnv('DB_USER'),
  password: siteEnv('DB_PASSWORD'),
  database: siteEnv('DB_NAME'),
  timezone: '-05:00',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_MAX || '3', 10),
  maxIdle: parseInt(process.env.DB_POOL_IDLE_MAX || '1', 10),
  idleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

process.on('SIGTERM', () => pool.end());
process.on('SIGINT', () => pool.end());

module.exports = pool;
