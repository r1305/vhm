const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '***REMOVED***',
  port: 3306,
  user: '***REMOVED***',
  password: '***REMOVED***',
  database: '***REMOVED***',
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
