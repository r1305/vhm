require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const lumaRoutes = require('./lumaRoutes');
const { ensureLumaSchema } = require('./lumaSchema');

const app = express();
process.env.TZ = 'America/Lima';

app.set('trust proxy', 1);

try {
  const compression = require('compression');
  app.use(compression({ threshold: 1024 }));
} catch (_) {}

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map(o => o.trim()) } : {}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(require('cookie-parser')());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === 'production')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const BASE_PATH = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
app.use((req, res, next) => { res.locals.basePath = BASE_PATH; next(); });

// CSRF (double-submit cookie)
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
  if (req.method === 'GET') {
    const existing = req.cookies?.csrf_token;
    if (!existing || !validateCsrfToken(existing)) {
      const token = generateCsrfToken();
      res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'strict', path: BASE_PATH || '/', secure: process.env.NODE_ENV === 'production' });
    }
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const publicPosts = ['/api/eventos'];
    const isPublic = req.method === 'POST' && publicPosts.some(p => req.path === p || req.path.startsWith('/api/eventos/'));
    const isAuthLogin = req.method === 'POST' && req.path === '/api/auth/login';
    if (!isPublic && !isAuthLogin) {
      const headerToken = req.headers['x-csrf-token'] || req.headers['csrf-token'];
      const cookieToken = req.cookies?.csrf_token;
      if (!validateCsrfToken(headerToken) || !validateCsrfToken(cookieToken) || headerToken !== cookieToken)
        return res.status(403).json({ error: 'Token CSRF inválido' });
    }
  }
  next();
});

// Lazy init
let initPromise = null;
function initOnce() {
  if (!initPromise) {
    initPromise = ensureLumaSchema().catch(err => {
      console.error('[luma] Error al inicializar schema:', err.message);
    });
  }
  return initPromise;
}
app.use((req, res, next) => { initOnce().then(() => next()).catch(() => next()); });

// Servir HTML con __APP_BASE__ inyectado (sin <base href> para evitar doble prefijo)
function sendHtml(res, filePath) {
  const base = (res.locals.basePath || '').replace(/\/$/, '');
  let html = fs.readFileSync(filePath, 'utf8');
  const inlineBase = `<script>window.__APP_BASE__=${JSON.stringify(base)};</script>`;
  html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inlineBase}`);
  res.set('Cache-Control', 'no-store').type('html').send(html);
}

// Rutas API
app.use('/api', lumaRoutes);

// Páginas HTML
app.get('/', (req, res) => sendHtml(res, path.join(__dirname, '../public/index.html')));
const adminHtml = path.join(__dirname, '../public/admin/index.html');
const adminPages = ['dashboard','eventos','registros','administradores','roles','accesos'];
app.get('/admin', (req, res) => sendHtml(res, adminHtml));
app.get('/admin/', (req, res) => sendHtml(res, adminHtml));
adminPages.forEach(p => app.get('/admin/' + p, (req, res) => sendHtml(res, adminHtml)));
app.get('/admin/login', (req, res) => sendHtml(res, path.join(__dirname, '../public/admin/login.html')));
app.get('/admin/login/', (req, res) => sendHtml(res, path.join(__dirname, '../public/admin/login.html')));

// Archivos estáticos
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d', index: false }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'luma' }));

app.use((err, req, res, next) => {
  console.error('[luma] Error:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
