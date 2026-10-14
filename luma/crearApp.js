const { setBasePath } = require('./src/mount');

function crearApp({ basePath = '/luma' } = {}) {
  setBasePath(basePath);
  return require('./src/index');
}

module.exports = { crearApp };
