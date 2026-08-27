require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { rewriteRootPaths } = require('../lib/mount');
const reclamosRoutes = require('./routes');
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');
const configEmailRoutes = require('./configEmailRoutes');
const configPixelRoutes = require('./configPixelRoutes');
const configWhatsappRoutes = require('./configWhatsappRoutes');
const testimoniosRoutes = require('./testimoniosRoutes');
const videosRoutes = require('./videosRoutes');
const claraRoutes = require('./claraRoutes');
const eventosRoutes = require('./eventosRoutes');
const configFacebookVerificationRoutes = require('./configFacebookVerificationRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);

try {
  const compression = require('compression');
  app.use(compression({ threshold: 1024 }));
} catch (_) { /* optional */ }

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : {}));
app.use(express.json({ limit: '1mb' }));
app.use(require('cookie-parser')());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net https://*.mlstatic.com https://sdk.mercadopago.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.mlstatic.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com https://*.mlstatic.com; connect-src 'self' https://connect.facebook.net https://graph.facebook.com https://*.mercadopago.com https://*.mercadopago.com.pe https://*.mlstatic.com https://*.mercadolibre.com; frame-src https://www.loom.com https://*.mercadopago.com https://*.mercadopago.com.pe https://*.mercadolibre.com; frame-ancestors 'none'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Base path para montaje bajo un prefijo (ej. /site)
const BASE_PATH = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
app.use((req, res, next) => {
  res.locals.basePath = BASE_PATH;
  next();
});

// CSRF protection (double-submit cookie pattern) - must be after BASE_PATH
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
app.use((req, res, next) => {
  // Set CSRF cookie on GET requests
  if (req.method === 'GET' && !req.cookies?.csrf_token) {
    const token = generateCsrfToken();
    res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'strict', path: BASE_PATH || '/' });
  }
  // Validate CSRF on state-changing methods (skip public POST endpoints)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const publicPostPaths = ['/api/reclamos', '/api/clara/chat', '/api/auth/login', '/api/tribu-access/verificar', '/api/tribu-auth/login', '/api/tribu-auth/registro', '/api/tribu-auth/recuperar', '/api/tribu-auth/reset-password', '/api/tribu-auth/cambiar-password-temp', '/api/tribu-pagos/webhook', '/api/tribu-pagos/procesar-pago', '/api/tribu-pagos/cron-renovaciones'];
    const isPublicPost = req.method === 'POST' && publicPostPaths.some(p => req.path === p);
    const isPublicCronRenovaciones = req.method === 'GET' && req.path === '/api/tribu-pagos/cron-renovaciones';
    const isPublicVideoAction = req.method === 'POST' && req.path.startsWith('/api/videos/') && (req.path.endsWith('/vista') || req.path.endsWith('/like'));
    const isTribuBearer = req.headers.authorization?.startsWith('Bearer ') &&
      (req.path.startsWith('/api/tribu-auth/') || req.path.startsWith('/api/tribu-pagos/'));
    if (!isPublicPost && !isPublicVideoAction && !isPublicCronRenovaciones && !isTribuBearer) {
      const headerToken = req.headers['x-csrf-token'] || req.headers['csrf-token'];
      const cookieToken = req.cookies?.csrf_token;
      if (!validateCsrfToken(headerToken) || !validateCsrfToken(cookieToken) || headerToken !== cookieToken) {
        return res.status(403).json({ error: 'Token CSRF inválido' });
      }
    }
  }
  next();
});

let initPromise = null;

function programarCronRenovaciones() {
  if (process.env.TRIBU_RENOVACION_CRON_ENABLED !== '1') return;
  const { runRenovacionesSuscripciones } = require('./tribuRenovaciones');

  const HOUR_MS = 60 * 60 * 1000;
  const timer = setInterval(async () => {
    try {
      const result = await runRenovacionesSuscripciones();
      if (result.processed > 0) {
        console.log(`[vhm] Renovaciones La Tribu: ${result.processed} procesadas`);
      }
    } catch (e) {
      console.error('[vhm] Error en cron renovaciones La Tribu:', e.message);
    }
  }, HOUR_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function programarCronTribu() {
  if (process.env.TRIBU_CRON_ENABLED !== '1') return;
  const { renovarPassword: renovarTribuPassword } = require('./tribuAccessRoutes');

  function msHastaProximoMiercoles12() {
    const ahora = new Date();
    const objetivo = new Date(ahora);
    const diasHasta = (3 - ahora.getDay() + 7) % 7 || 7;
    objetivo.setDate(ahora.getDate() + diasHasta);
    objetivo.setHours(12, 0, 0, 0);
    return objetivo - ahora;
  }

  function programar() {
    const ms = msHastaProximoMiercoles12();
    const timer = setTimeout(async () => {
      try {
        await renovarTribuPassword();
        console.log('[vhm] Contraseña de La Tribu renovada automáticamente');
      } catch (e) {
        console.error('[vhm] Error al renovar contraseña de La Tribu:', e.message);
      }
      programar();
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  }

  programar();
}

function initAppOnce() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await require('./ensureSchema').ensureVideoSchema();
      } catch (err) {
        console.error('[vhm] No se pudo asegurar el esquema:', err.message);
      }
      programarCronTribu();
      programarCronRenovaciones();
    })();
  }
  return initPromise;
}

// Inicialización perezosa: evita conectar BD al arrancar cada worker
app.use((req, res, next) => {
  initAppOnce().then(() => next()).catch(() => next());
});

function sendPublicHtml(res, filename) {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const filePath = path.join(__dirname, '../public', filename);
  let html = fs.readFileSync(filePath, 'utf8');
  // Inject __APP_BASE__ inline so it's always available before any other script
  const inlineBase = `<script>window.__APP_BASE__=${JSON.stringify(base)};</script>`;
  html = html.replace(/\bsrc="__app_base__\.js"/g, '');
  html = html.replace(/<script><\/script>/g, '');  // cleanup empty script from above
  html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inlineBase}`);
  if (base) {
    if (!html.includes('<base ')) {
      html = html.replace(/(<head[^>]*>)/i, `$1\n  <base href="${base}/">`);
    }
    html = rewriteRootPaths(html, base);
  }
  res.type('html').send(html);
}

const ADMIN_DIR = path.join(__dirname, '../public/admin');
const ADMIN_PAGES = [
  'login.html',
  'reclamos.html',
  'testimonios.html',
  'videos.html',
  'tribu-users.html',
  'usuarios.html',
  'config.html',
  'index.html',
];

function sendAdminHtml(res, filename) {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const filePath = path.join(ADMIN_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).type('text/plain').send('Admin page not found: ' + filename);
  }
  let html = fs.readFileSync(filePath, 'utf8');
  const inlineBase = `<script>window.__APP_BASE__=${JSON.stringify(base)};</script>`;
  html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inlineBase}`);
  html = html.replace(/(<head[^>]*>)/i, `$1\n  <base href="${base}/admin/">`);
  if (base) {
    html = rewriteRootPaths(html, base);
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.type('html').send(html);
}

function sendAdminAsset(subdir, file, res) {
  if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) {
    return res.status(400).type('text/plain').send('Invalid file');
  }
  const dir = path.join(ADMIN_DIR, subdir);
  const filePath = path.join(dir, file);
  if (!filePath.startsWith(dir + path.sep) || !fs.existsSync(filePath)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(filePath);
}

// Admin assets — rutas explícitas (evita que HTML reemplace JS/CSS en producción)
app.get('/admin/js/:file', (req, res) => sendAdminAsset('js', req.params.file, res));
app.get('/admin/css/:file', (req, res) => sendAdminAsset('css', req.params.file, res));

ADMIN_PAGES.forEach((page) => {
  app.get('/admin/' + page, (req, res) => sendAdminHtml(res, page));
});

app.get('/', (req, res) => sendPublicHtml(res, 'index.html'));

// Fallback para __app_base__.js cuando se corre standalone (sin gateway)
app.get('/__app_base__.js', (req, res) => {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.type('application/javascript').set('Cache-Control', 'no-store').send(`window.__APP_BASE__=${JSON.stringify(base)};`);
});

app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1d',
  index: false,
}));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'vhm-site', admin: 'html', version: 'html-admin-v3' });
});

app.get('/api/deploy-info', (req, res) => {
  const versionFile = path.join(__dirname, '../public/DEPLOY_VERSION.txt');
  let version = null;
  if (fs.existsSync(versionFile)) {
    version = fs.readFileSync(versionFile, 'utf8').trim();
  }
  res.json({
    ok: true,
    version,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    tribuCronEnabled: process.env.TRIBU_CRON_ENABLED === '1',
    dbPoolMax: process.env.DB_POOL_MAX || '3',
    adminDir: fs.existsSync(ADMIN_DIR),
    adminJs: fs.existsSync(path.join(ADMIN_DIR, 'js', 'api.js')),
  });
});

app.get(['/admin', '/admin/'], (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(base + '/admin/login.html');
});

app.get('/consulta', (req, res) => {
  sendPublicHtml(res, 'consulta.html');
});

app.get('/reclamo', (req, res) => {
  sendPublicHtml(res, 'reclamo.html');
});

app.get('/latribu', (req, res) => {
  sendPublicHtml(res, 'videos.html');
});

// Compatibilidad: rutas anteriores redirigen a La Tribu.
app.get('/caminointerior', (req, res) => {
  res.redirect(301, (res.locals.basePath || '') + '/latribu');
});
app.get('/videos', (req, res) => {
  res.redirect(301, (res.locals.basePath || '') + '/latribu');
});

// Ruta pública para obtener configuración del pixel
app.get('/api/pixel-config', async (req, res) => {
  try {
    const pool = require('./db');
    const [rows] = await pool.execute('SELECT pixel_id, activo FROM config_pixel WHERE id = 1 AND activo = 1');
    const payload = rows[0] || { pixel_id: null, activo: false };
    payload._deployVersion = 'html-admin-v3';
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.json({ pixel_id: null, activo: false, _deployVersion: 'html-admin-v3' });
  }
});

// Ruta pública para obtener configuración de WhatsApp
app.get('/api/whatsapp-config', async (req, res) => {
  try {
    const pool = require('./db');
    const [rows] = await pool.execute('SELECT numero, mensaje, activo FROM config_whatsapp WHERE id = 1 AND activo = 1');
    res.json(rows[0] || { numero: null, mensaje: null, activo: false });
  } catch (err) {
    console.error(err);
    res.json({ numero: null, mensaje: null, activo: false });
  }
});

// Ruta pública para obtener redes sociales
app.get('/api/redes', async (req, res) => {
  try {
    const pool = require('./db');
    const [rows] = await pool.execute('SELECT instagram, facebook, youtube, tiktok FROM config_redes WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) {
    res.json({});
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/reclamos', reclamosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/config-email', configEmailRoutes);
app.use('/api/config-pixel', configPixelRoutes);
app.use('/api/config-whatsapp', configWhatsappRoutes);
app.use('/api/config-redes', require('./configRedesRoutes'));
app.use('/api/testimonios', testimoniosRoutes);
app.use('/api/videos', videosRoutes);
app.use('/api/clara', claraRoutes);
app.use('/api/eventos', eventosRoutes);
app.use('/api/config-facebook-verification', configFacebookVerificationRoutes);
app.use('/api/suscripciones', require('./suscripcionesRoutes'));
app.use('/api/config-mercadopago', require('./configMercadoPagoRoutes'));
const { router: tribuAccessRouter } = require('./tribuAccessRoutes');
app.use('/api/tribu-access', tribuAccessRouter);
app.use('/api/tribu-users', require('./tribuUsersRoutes'));
const { router: tribuAuthRouter } = require('./tribuAuthRoutes');
app.use('/api/tribu-auth', tribuAuthRouter);
app.use('/api/tribu-pagos', require('./tribuPagosRoutes'));

// Error handler global
app.use((err, req, res, next) => {
  console.error('[vhm] Error no capturado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

if (require.main === module) {
  initAppOnce().then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
