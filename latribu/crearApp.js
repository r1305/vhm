const { setBasePath } = require('./lib/mount');

function crearApp({ basePath = '/latribu', crons = false } = {}) {
  setBasePath(basePath);
  const app = require('./src/index');
  if (!crons) app.detenerCronLatribu();
  return app;
}

module.exports = { crearApp };
