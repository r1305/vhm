const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '***REMOVED***',
  port: 3306,
  user: '***REMOVED***',
  password: '***REMOVED***',
  database: '***REMOVED***',
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool;
