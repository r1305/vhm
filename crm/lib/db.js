require('dotenv').config();
const path = require('path');
// Garantizar que se carga el .env de esta carpeta
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Todo el proyecto trabaja en hora de Lima, sin importar la zona del servidor
// donde corra. Debe fijarse ANTES de usar cualquier fecha.
process.env.TZ = 'America/Lima';

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

// El servidor MySQL puede tener su propia zona (en este proyecto se ha detectado
// CEST, UTC+2) mientras el proceso Node usa America/Lima. Esa diferencia hace que
// las funciones de fecha de MySQL -NOW(), CURDATE(), CURRENT_TIMESTAMP, que se
// usan en ~79 consultas- devuelvan una hora distinta a la que ve el usuario:
// entre 17:00 y 23:59 hora Lima MySQL ya creeria que es el dia siguiente.
//
// Fijando la zona de la SESION en -05:00, MySQL evalua esas funciones en hora de
// Lima y el SQL coincide con Node y con el navegador.
//
// Importante: los TIMESTAMP ya guardados NO se reescriben. MySQL los almacena
// como instante absoluto, asi que solo cambia como se muestran y se calculan.
const LIMA_OFFSET = '-05:00';
pool.on('connection', (conn) => {
  conn.query("SET time_zone = ?", [LIMA_OFFSET]);
});

module.exports = pool;
