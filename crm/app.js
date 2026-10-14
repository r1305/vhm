require('dotenv').config();
process.env.TZ = 'America/Lima';
const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

const { crearApp, prepararDatos } = require('./crearApp');
const crones = require('./crones');

const BASE = (process.env.APP_MOUNT_PATH || '/crm').replace(/\/$/, '');
const { app: crmApp, sessionStore } = crearApp({ basePath: BASE, alCambiarCron: () => crones.scheduleCron() });

const app = express();
app.set('trust proxy', 1);
app.use(BASE, crmApp);
app.get('/', (_, res) => res.redirect(BASE + '/'));

let _shutdownPromise = null;
function shutdown(signal) {
  if (_shutdownPromise) return _shutdownPromise;
  console.log(`[crm] ${signal} recibido, cerrando recursos...`);
  _shutdownPromise = (async () => {
    crones.detenerCrons();
    try { await sessionStore.close(); } catch (_) {}
    let forceTimer = null;
    const limite = new Promise((resolve) => {
      forceTimer = setTimeout(resolve, 5000);
      if (typeof forceTimer.unref === 'function') forceTimer.unref();
    });
    await Promise.race([
      Promise.allSettled([
        require('./lib/db').end(),
        require('./lib/tribuDb').closePool(),
      ]),
      limite,
    ]);
    clearTimeout(forceTimer);
  })();
  return _shutdownPromise;
}
process.on('SIGTERM', () => { shutdown('SIGTERM').finally(() => process.exit(0)); });
process.on('SIGINT', () => { shutdown('SIGINT').finally(() => process.exit(0)); });

prepararDatos()
  .then(() => crones.iniciarCrons())
  .then(() => {
    if (typeof PhusionPassenger !== 'undefined') {
      PhusionPassenger.configure({
        autoInstall: false,
        maxPoolSize: parseInt(process.env.PASSENGER_MAX_POOL_SIZE || '1', 10),
      });
      app.listen('passenger');
    } else if (require.main === module) {
      const PORT = process.env.PORT || 3001;
      app.listen(PORT, () => console.log(`[vhm-crm] http://localhost:${PORT}${BASE}/`));
    }
  })
  .catch(err => console.error('[crm] Init error:', err.message));

module.exports = app;
