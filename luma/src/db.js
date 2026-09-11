require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: '-05:00',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_MAX || '3', 10),
  maxIdle: parseInt(process.env.DB_POOL_IDLE_MAX || '1', 10),
  idleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '-05:00'");
});

process.on('SIGTERM', () => pool.end());
process.on('SIGINT',  () => pool.end());

module.exports = pool;
