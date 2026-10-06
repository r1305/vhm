require('dotenv').config();
// Ensure APP_MOUNT_PATH is set; fallback to '/latribu' for development
if (!process.env.APP_MOUNT_PATH) {
  process.env.APP_MOUNT_PATH = '/latribu';
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { rewriteRootPaths } = require('../lib/mount');
const { createCsrfMiddleware } = require('./middleware/csrf');

const app = express();

app.set('trust proxy', 1);

try {
  const compression = require('compression');
  app.use(compression({ threshold: 1024 }));
} catch (_) { /* optional */ }

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map(o => o.trim()) } : {}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(require('cookie-parser')());

const BASE_PATH = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
app.use((req, res, next) => { res.locals.basePath = BASE_PATH; next(); });

// CSRF protection
app.use(createCsrfMiddleware());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net https://checkout.culqi.com https://js.culqi.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; media-src 'self' https://drive.google.com https://drive.usercontent.google.com https://*.googleusercontent.com blob:; connect-src 'self' https://connect.facebook.net https://graph.facebook.com https://api.culqi.com https://checkout.culqi.com https://checkoutview.culqi.com https://js.culqi.com; frame-src https://www.loom.com https://checkout.culqi.com https://checkoutview.culqi.com https://js.culqi.com; frame-ancestors 'none'`
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

function inlineAppConfig(base) {
  return `<script>window.__APP_BASE__=${JSON.stringify(base)};</script>`;
}

const ADMIN_DIR = path.join(__dirname, '../public/admin');
const ADMIN_PAGES = ['login.html', 'videos.html', 'tribu-users.html', 'plantillas.html', 'encuestas.html', 'testimonios.html', 'posts.html', 'contenido.html', 'usuarios.html', 'config.html', 'accesos.html', 'index.html'];

function sendAdminHtml(res, filename) {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const filePath = path.join(ADMIN_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).type('text/plain').send('Admin page not found: ' + filename);
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inlineAppConfig(base)}`);
  html = html.replace(/(<head[^>]*>)/i, `$1\n  <base href="${base}/admin/">`);
  if (base) html = rewriteRootPaths(html, base);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache').set('Expires', '0');
  res.type('html').send(html);
}

function sendAdminAsset(subdir, file, res) {
  if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) return res.status(400).type('text/plain').send('Invalid file');
  const dir = path.join(ADMIN_DIR, subdir);
  const filePath = path.join(dir, file);
  if (!filePath.startsWith(dir + path.sep) || !fs.existsSync(filePath)) return res.status(404).type('text/plain').send('Not found');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(filePath);
}

function sendPublicHtml(res, filename) {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const filePath = path.join(__dirname, '../public', filename);
  if (!fs.existsSync(filePath)) return res.status(404).type('text/plain').send('Not found: ' + filename);
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inlineAppConfig(base)}`);
  if (base) {
    if (!html.includes('<base ')) html = html.replace(/(<head[^>]*>)/i, `$1\n  <base href="${base}/">`);
    html = rewriteRootPaths(html, base);
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache').set('Expires', '0');
  res.type('html').send(html);
}

// Lazy init
let initPromise = null;

function programarCronRenovaciones() {
  if (process.env.TRIBU_RENOVACION_CRON_ENABLED !== '1') return;
  const { runRenovacionesSuscripciones } = require('./tribuRenovaciones');
  const timer = setInterval(async () => {
    try {
      const result = await runRenovacionesSuscripciones();
      if (result.processed > 0) console.log(`[latribu] Renovaciones: ${result.processed} procesadas`);
    } catch (e) { console.error('[latribu] Error en cron renovaciones:', e.message); }
  }, 60 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

function programarCronTribu() {
  if (process.env.TRIBU_CRON_ENABLED !== '1') return;
  const { renovarPassword } = require('./tribuAccessRoutes');
  function msHastaProximoMiercoles12() {
    const ahora = new Date();
    const objetivo = new Date(ahora);
    const diasHasta = (3 - ahora.getDay() + 7) % 7 || 7;
    objetivo.setDate(ahora.getDate() + diasHasta);
    objetivo.setHours(12, 0, 0, 0);
    return objetivo - ahora;
  }
  function programar() {
    const timer = setTimeout(async () => {
      try { await renovarPassword(); console.log('[latribu] Contraseña de La Tribu renovada automáticamente'); }
      catch (e) { console.error('[latribu] Error al renovar contraseña:', e.message); }
      programar();
    }, msHastaProximoMiercoles12());
    if (typeof timer.unref === 'function') timer.unref();
  }
  programar();
}

function initAppOnce() {
  if (!initPromise) {
    initPromise = (async () => {
      try { await require('./schema').ensureSchema(); }
      catch (err) { console.error('[latribu] No se pudo asegurar el esquema:', err.message); }
      programarCronTribu();
      programarCronRenovaciones();
    })();
  }
  return initPromise;
}

app.use((req, res, next) => { initAppOnce().then(() => next()).catch(() => next()); });

// Admin assets
app.get('/admin/js/:file', (req, res) => sendAdminAsset('js', req.params.file, res));
app.get('/admin/css/:file', (req, res) => sendAdminAsset('css', req.params.file, res));

ADMIN_PAGES.forEach(page => {
  app.get('/admin/' + page, (req, res) => sendAdminHtml(res, page));
});

app.get(['/admin', '/admin/'], (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(base + '/admin/login.html');
});

// Public pages — funnel de conversión
app.get('/', (req, res) => sendPublicHtml(res, 'landing.html'));
app.get('/inicio', (req, res) => sendPublicHtml(res, 'inicio.html'));
app.get('/camino', (req, res) => sendPublicHtml(res, 'index.html'));
app.get('/checkout', (req, res) => sendPublicHtml(res, 'checkout.html'));
app.get('/confirmacion', (req, res) => sendPublicHtml(res, 'confirmacion.html'));
app.get('/crear-contrasena', (req, res) => sendPublicHtml(res, 'crear-contrasena.html'));
app.get('/empezar', (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(base + '/empezar/que-buscas');
});
app.get('/empezar/que-buscas', (req, res) => sendPublicHtml(res, 'empezar.html'));
app.get('/empezar/como-empezar', (req, res) => sendPublicHtml(res, 'empezar.html'));
app.get('/empezar/intereses', (req, res) => sendPublicHtml(res, 'empezar.html'));
app.get('/empezar/primer-paso', (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(302, base + '/inicio');
});
app.get('/bienestar', (req, res) => sendPublicHtml(res, 'bienestar.html'));
app.get('/mi-prueba', (req, res) => sendPublicHtml(res, 'mi-prueba.html'));
app.get('/recordatorio', (req, res) => sendPublicHtml(res, 'recordatorio.html'));
app.get('/estados', (req, res) => sendPublicHtml(res, 'estados.html'));
app.get('/biblioteca', (req, res) => sendPublicHtml(res, 'recursos.html'));
app.get('/membresia', (req, res) => sendPublicHtml(res, 'suscripciones.html'));
app.get('/suscripciones', (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(301, base + '/membresia');
});

app.get('/guia', (req, res) => sendPublicHtml(res, 'guia-funnel.html'));
app.get('/perfil', (req, res) => sendPublicHtml(res, 'perfil.html'));
app.get('/tarjetas', (req, res) => sendPublicHtml(res, 'tarjetas.html'));
app.get('/encuesta/:slug', (req, res) => sendPublicHtml(res, 'encuesta.html'));
app.get('/recursos', (req, res) => sendPublicHtml(res, 'recursos.html'));
app.get('/calendario', (req, res) => sendPublicHtml(res, 'calendario.html'));
app.get('/comunidad', (req, res) => sendPublicHtml(res, 'comunidad.html'));
app.get('/comunidad.html', (req, res) => sendPublicHtml(res, 'comunidad.html'));

// Segunda capa para /uploads: las imagenes se validan por contenido al
// subirlas (lib/subidaImagen.js), pero un archivo antiguo o subido por otra
// ruta no deberia poder ejecutarse en el origen si alguien lo abre directo.
// nosniff evita que el navegador obedezca a un Content-Type ambiguo.
app.use((req, res, next) => {
  if (req.path.startsWith('/uploads/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d', index: false }));

// Media (shared from repo root)
const REPO_MEDIA_DIR = path.join(__dirname, '../../media');
if (fs.existsSync(REPO_MEDIA_DIR)) {
  app.use('/media', express.static(REPO_MEDIA_DIR, { maxAge: '1h', index: false, fallthrough: true }));
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'latribu', version: '1.0.0' }));

// API routes
app.use('/api/auth', require('./authRoutes'));
app.use('/api/usuarios', require('./usuariosRoutes'));
app.use('/api/accesos', require('./accesosRoutes'));
app.use('/api/videos', require('./videosRoutes'));
app.use('/api/eventos', require('./eventosRoutes'));
app.use('/api/plantillas', require('./plantillasRoutes'));
app.use('/api/encuestas', require('./encuestasRoutes'));
app.use('/api/testimonios', require('./testimoniosRoutes'));
app.use('/api/suscripciones', require('./suscripcionesRoutes'));
app.use('/api/config-culqi', require('./configCulqiRoutes'));
app.use('/api', require('./configRoutes'));
const { router: tribuAccessRouter } = require('./tribuAccessRoutes');
app.use('/api/tribu-access', tribuAccessRouter);
app.use('/api/tribu-users', require('./tribuUsersRoutes'));
const { router: tribuAuthRouter } = require('./tribuAuthRoutes');
app.use('/api/tribu-auth', tribuAuthRouter);
app.use('/api/tribu-pagos', require('./tribuPagosRoutes'));
app.use('/api/tribu-catalogo', require('./tribuCatalogoRoutes'));
app.use('/api/contenido', require('./contenidoRoutes'));
app.use('/api/posts', require('./postsRoutes'));

app.use((err, req, res, next) => {
  console.error('[latribu] Error no capturado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;