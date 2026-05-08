const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'bh8980.banahosting.com',
  port: 3306,
  user: 'gsqorodg_vhm',
  password: '$vhm2026$',
  database: 'gsqorodg_vhm',
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool;
