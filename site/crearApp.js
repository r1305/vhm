const { setBasePath } = require('./lib/mount');

function crearApp({ basePath = '' } = {}) {
  setBasePath(basePath);
  return require('./src/index');
}

module.exports = { crearApp };
