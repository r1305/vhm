const env = require('./env');
let basePathFijo = null;

function setBasePath(p) {
  basePathFijo = String(p || '').replace(/\/$/, '');
}

function basePath() {
  return basePathFijo ?? (env('APP_MOUNT_PATH') || '/luma');
}

module.exports = { setBasePath, basePath };
