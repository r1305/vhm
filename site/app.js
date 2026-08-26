require('dotenv').config();
const express = require('express');

// Forzar GMT-5 (Lima) en todo el proceso antes de cualquier operacion de fecha
process.env.TZ = 'America/Lima';

const vhmApp = require('./src/index');

const MOUNT_PATH = process.env.APP_MOUNT_PATH || '/site';
const shell = express();
shell.set('trust proxy', 1);

shell.get('/health', (req, res) => {
  res.json({ ok: true, service: 'vhm', mountPath: MOUNT_PATH });
});

shell.use(MOUNT_PATH, vhmApp);

// Redirigir raíz al site
shell.get('/', (req, res) => res.redirect(MOUNT_PATH + '/'));

if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({
    autoInstall: false,
    // Limitar workers Node en hosting compartido (evita picos de procesos)
    maxPoolSize: parseInt(process.env.PASSENGER_MAX_POOL_SIZE || '2', 10),
  });
  shell.listen('passenger');
} else if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  shell.listen(PORT, () => {
    console.log(`[vhm] http://localhost:${PORT}${MOUNT_PATH}/`);
  });
}

module.exports = shell;
