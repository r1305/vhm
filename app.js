require('dotenv').config();
const express = require('express');
const vhmApp = require('./src/index');

const MOUNT_PATH = process.env.APP_MOUNT_PATH || '/site';
const shell = express();
shell.set('trust proxy', 1);

shell.use(MOUNT_PATH, vhmApp);
shell.get('/', (req, res) => res.redirect(MOUNT_PATH + '/'));

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
