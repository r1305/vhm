require('dotenv').config();
const express = require('express');

process.env.TZ = 'America/Lima';

const lumaApp = require('./src/index');

const MOUNT_PATH = process.env.APP_MOUNT_PATH || '/luma';
const shell = express();
shell.set('trust proxy', 1);

shell.get('/health', (req, res) => {
  res.json({ ok: true, service: 'luma', mountPath: MOUNT_PATH });
});

shell.get('/', (req, res) => res.redirect(MOUNT_PATH + '/'));

shell.use(MOUNT_PATH, lumaApp);

if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({
    autoInstall: false,
    maxPoolSize: parseInt(process.env.PASSENGER_MAX_POOL_SIZE || '2', 10),
  });
  shell.listen('passenger');
} else if (require.main === module) {
  const PORT = process.env.PORT || 3002;
  shell.listen(PORT, () => {
    console.log(`[luma] http://localhost:${PORT}${MOUNT_PATH}/`);
  });
}

module.exports = shell;
