require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { rewriteRootPaths } = require('../lib/mount');

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
app.use((req, res, next) => { res.locals.basePath = BASE_PATH; next(); });

// CSRF protection
const CSRF_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
function generateCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const sig = crypto.createHmac('sha256', CSRF_SECRET).update(token).digest('hex').slice(0, 16);
  return `${token}.${sig}`;
}
function validateCsrfToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [val, sig] = token.split('.');
  if (!val || !sig) return false;
  const expected = crypto.createHmac('sha256', CSRF_SECRET).update(val).digest('hex').slice(0, 16);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}
function csrfCookieOptions() {
  return { httpOnly: false, sameSite: 'strict', path: BASE_PATH || '/', secure: process.env.NODE_ENV === 'production' };
}
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const existing = req.cookies?.csrf_token;
    if (!existing || !validateCsrfToken(existing)) {
      res.cookie('csrf_token', generateCsrfToken(), csrfCookieOptions());
    }
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const publicPostPaths = [
      '/api/auth/login', '/api/tribu-access/verificar',
      '/api/tribu-auth/login', '/api/tribu-auth/registro',
      '/api/tribu-auth/recuperar', '/api/tribu-auth/reset-password',
      '/api/tribu-auth/cambiar-password-temp',
      '/api/tribu-pagos/webhook', '/api/tribu-pagos/procesar-pago',
      '/api/tribu-pagos/cron-renovaciones',
    ];
    const isPublicEncuestaPost = req.method === 'POST' && /^\/api\/encuestas\/public\/[^/]+\/responder$/.test(req.path);
    const isPublicPost = req.method === 'POST' && publicPostPaths.some(p => req.path === p);
    const isPublicVideoAction = req.method === 'POST' && req.path.startsWith('/api/videos/') && (req.path.endsWith('/vista') || req.path.endsWith('/like'));
    const isTribuBearer = req.headers.authorization?.startsWith('Bearer ') &&
      (req.path.startsWith('/api/tribu-auth/') || req.path.startsWith('/api/tribu-pagos/'));
    if (!isPublicPost && !isPublicEncuestaPost && !isPublicVideoAction && !isTribuBearer) {
      const headerToken = req.headers['x-csrf-token'] || req.headers['csrf-token'];
      const cookieToken = req.cookies?.csrf_token;
      if (!validateCsrfToken(headerToken) || !validateCsrfToken(cookieToken) || headerToken !== cookieToken) {
        return res.status(403).json({ error: 'Token CSRF inválido' });
      }
    }
  }
  next();
});

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
const ADMIN_PAGES = ['login.html', 'videos.html', 'tribu-users.html', 'plantillas.html', 'encuestas.html', 'testimonios.html', 'usuarios.html', 'config.html', 'accesos.html', 'index.html'];

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

// Public pages
app.get('/', (req, res) => sendPublicHtml(res, 'index.html'));
app.get('/encuesta/:slug', (req, res) => sendPublicHtml(res, 'encuesta.html'));

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

app.use((err, req, res, next) => {
  console.error('[latribu] Error no capturado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
