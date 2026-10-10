require('dotenv').config();
const express = require('express');

process.env.TZ = 'America/Lima';

const tribuApp = require('./src/index');
const { crearGracefulShutdown, registrarSenales } = require('./src/lib/apagado');

const MOUNT_PATH = process.env.APP_MOUNT_PATH || '/latribu';
const shell = express();
shell.set('trust proxy', 1);

shell.get('/health', (req, res) => {
  res.json({ ok: true, service: 'latribu', mountPath: MOUNT_PATH });
});

shell.use(MOUNT_PATH, tribuApp);
shell.get('/', (req, res) => res.redirect(MOUNT_PATH + '/'));

let server = null;

const gracefulShutdown = crearGracefulShutdown({
  obtenerServidor: () => server,
  detenerTimers: [
    () => tribuApp.detenerCronLatribu(),
    () => require('./src/authRoutes').stopLoginAttemptsCleanup(),
    () => require('./src/tribuAuthRoutes').stopLoginAttemptsCleanup(),
    () => require('./src/lib/rateLimitMemoria').detenerLimpieza(),
  ],
  cerrarPool: () => require('./src/db').end(),
  cerrarMailer: () => require('./lib/mailer').closeMailer(),
});

if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({
    autoInstall: false,
    maxPoolSize: parseInt(process.env.PASSENGER_MAX_POOL_SIZE || '2', 10),
  });
  server = shell.listen('passenger');
  registrarSenales(gracefulShutdown);
} else if (require.main === module) {
  const PORT = process.env.PORT || 3002;
  server = shell.listen(PORT, () => {
    console.log(`[latribu] http://localhost:${PORT}${MOUNT_PATH}/`);
  });
  registrarSenales(gracefulShutdown);
}

module.exports = shell;
module.exports.gracefulShutdown = gracefulShutdown;
