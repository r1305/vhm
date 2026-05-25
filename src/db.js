const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'bh8980.banahosting.com',
  port: 3306,
  user: 'gsqorodg_vhm',
  password: '$vhm2026$',
  database: 'gsqorodg_vhm',
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 2,
  idleTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

process.on('SIGTERM', () => pool.end());
process.on('SIGINT', () => pool.end());

module.exports = pool;
