process.env.TZ = 'America/Lima';

const path = require('path');
const express = require('express');
const envVhm = require('../lib/env');
const { crearGracefulShutdown, registrarSenales } = require('../latribu/src/lib/apagado');

const RAIZ = path.join(__dirname, '..');
const APPS = ['latribu', 'crm', 'luma', 'site'];

// Cada app lee sus variables con prefijo (CRM_, TRIBU_, LUMA_, SITE_) desde process.env o el .env raíz
// y, en desarrollo local, desde su propio .env. Solo NODE_ENV, PORT y TZ se comparten.
function crearAppUnificada({ cargarEnv = true } = {}) {
  envVhm.configurar({ estricto: true, archivos: cargarEnv });
  envVhm.aplicarComunes(APPS.map((n) => path.join(RAIZ, n)));

  const crones = require('../crm/crones');
  const crm = require('../crm/crearApp').crearApp({ basePath: '/crm', alCambiarCron: () => crones.scheduleCron() });
  const luma = require('../luma/crearApp').crearApp({ basePath: '/luma' });
  const latribu = require('../latribu/crearApp').crearApp({ basePath: '/latribu' });
  const site = require('../site/crearApp').crearApp({ basePath: '' });

  const app = express();
  app.set('trust proxy', 1);
  app.get('/health', (req, res) => res.json({ ok: true, service: 'vhm-unificado' }));
  app.use('/crm', crm.app);
  app.use('/luma', luma);
  app.use('/latribu', latribu);
  // Lo que una sub-app no resuelve no debe caer en el middleware de site (CSRF, CSP).
  app.use(['/crm', '/luma', '/latribu'], (req, res) => res.status(404).type('text/plain').send('Not found'));
  // Compatibilidad: la BD guarda fotos con el prefijo /site de la versión standalone.
  app.get(['/site', '/site/'], (req, res) => res.redirect(301, '/'));
  app.use('/site/media', express.static(path.join(RAIZ, 'media'), { maxAge: '1h', index: false }));
  app.use('/site', express.static(path.join(RAIZ, 'site/public'), { maxAge: '1d', index: false }));
  app.use('/', site);

  // Solo el proceso unificado programa crons, una vez: las factorías crearApp no lo hacen.
  async function iniciarCrons() {
    latribu.iniciarCronLatribu();
    await require('../crm/crearApp').prepararDatos();
    await crones.iniciarCrons();
  }

  async function cerrar() {
    crones.detenerCrons();
    latribu.detenerCronLatribu();
    require('../latribu/src/authRoutes').stopLoginAttemptsCleanup();
    require('../latribu/src/tribuAuthRoutes').stopLoginAttemptsCleanup();
    require('../latribu/src/lib/rateLimitMemoria').detenerLimpieza();
    await Promise.allSettled([
      () => crm.sessionStore.close(),
      () => require('../crm/lib/db').end(),
      () => require('../crm/lib/tribuDb').closePool(),
      () => require('../latribu/src/db').end(),
      () => require('../latribu/lib/mailer').closeMailer(),
      () => require('../luma/src/db').end(),
      () => require('../site/src/db').end(),
    ].map((f) => Promise.resolve().then(f)));
  }

  return { app, cerrar, iniciarCrons };
}

function arrancar() {
  const { app, cerrar, iniciarCrons } = crearAppUnificada();
  let server = null;
  if (typeof PhusionPassenger !== 'undefined') {
    PhusionPassenger.configure({ autoInstall: false, maxPoolSize: 1 });
    server = app.listen('passenger');
  } else {
    const PORT = process.env.PORT || 3000;
    server = app.listen(PORT, () => console.log(`[vhm-unificado] http://localhost:${PORT}/ (crm, luma, latribu y site)`));
  }
  registrarSenales(crearGracefulShutdown({ obtenerServidor: () => server, cerrarPool: cerrar }));
  iniciarCrons().catch((err) => console.error('[vhm-unificado] Init error:', err.message));
}

if (process.env.NODE_ENV !== 'test') arrancar();

module.exports = { crearAppUnificada };
