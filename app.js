require('dotenv').config();
const express = require('express');
const vhmApp = require('./src/index');

const MOUNT_PATH = process.env.APP_MOUNT_PATH || '/site';
const shell = express();
shell.set('trust proxy', 1);

// Health check para debug
shell.get('/health', (req, res) => {
  res.json({ ok: true, mountPath: MOUNT_PATH, url: req.url, originalUrl: req.originalUrl });
});

shell.use(MOUNT_PATH, vhmApp);
shell.get('/', (req, res) => res.redirect(MOUNT_PATH + '/'));

// Catch-all para debug
shell.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path, originalUrl: req.originalUrl, mountPath: MOUNT_PATH });
});

if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
  shell.listen('passenger');
} else if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  shell.listen(PORT, () => {
    console.log(`[vhm] http://localhost:${PORT}${MOUNT_PATH}/`);
  });
}

module.exports = shell;
