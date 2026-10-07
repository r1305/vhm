const express = require('express');
const path = require('path');
const fs = require('fs');
const { rewriteRootPaths } = require('../lib/mount');

const router = express.Router();

const ADMIN_DIR = path.join(__dirname, '../public/admin');
const ADMIN_PAGES = ['login.html', 'videos.html', 'tribu-users.html', 'plantillas.html', 'encuestas.html', 'testimonios.html', 'posts.html', 'contenido.html', 'usuarios.html', 'config.html', 'accesos.html', 'index.html'];

const htmlCache = new Map();

function getCachedHtml(filePath) {
  if (htmlCache.has(filePath)) return htmlCache.get(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  htmlCache.set(filePath, content);
  return content;
}

function inlineAppConfig(base) {
  return `<script>window.__APP_BASE__=${JSON.stringify(base)};</script>`;
}

function sendAdminHtml(res, filename) {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const filePath = path.join(ADMIN_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).type('text/plain').send('Admin page not found: ' + filename);
  
  let html = getCachedHtml(filePath);
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
  
  let html = getCachedHtml(filePath);
  html = html.replace(/(<head[^>]*>)/i, `$1\n  ${inlineAppConfig(base)}`);
  if (base) {
    if (!html.includes('<base ')) html = html.replace(/(<head[^>]*>)/i, `$1\n  <base href="${base}/">`);
    html = rewriteRootPaths(html, base);
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache').set('Expires', '0');
  res.type('html').send(html);
}

router.get('/admin/js/:file', (req, res) => sendAdminAsset('js', req.params.file, res));
router.get('/admin/css/:file', (req, res) => sendAdminAsset('css', req.params.file, res));

ADMIN_PAGES.forEach(page => {
  router.get('/admin/' + page, (req, res) => sendAdminHtml(res, page));
});

router.get(['/admin', '/admin/'], (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(base + '/admin/login.html');
});

router.get('/', (req, res) => sendPublicHtml(res, 'landing.html'));
router.get('/inicio', (req, res) => sendPublicHtml(res, 'inicio.html'));
router.get('/camino', (req, res) => sendPublicHtml(res, 'index.html'));
router.get('/checkout', (req, res) => sendPublicHtml(res, 'checkout.html'));
router.get('/confirmacion', (req, res) => sendPublicHtml(res, 'confirmacion.html'));
router.get('/crear-contrasena', (req, res) => sendPublicHtml(res, 'crear-contrasena.html'));
router.get('/empezar', (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(base + '/empezar/que-buscas');
});
router.get('/empezar/que-buscas', (req, res) => sendPublicHtml(res, 'empezar.html'));
router.get('/empezar/como-empezar', (req, res) => sendPublicHtml(res, 'empezar.html'));
router.get('/empezar/intereses', (req, res) => sendPublicHtml(res, 'empezar.html'));
router.get('/empezar/primer-paso', (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(302, base + '/inicio');
});
router.get('/bienestar', (req, res) => sendPublicHtml(res, 'bienestar.html'));
router.get('/mi-prueba', (req, res) => sendPublicHtml(res, 'mi-prueba.html'));
router.get('/recordatorio', (req, res) => sendPublicHtml(res, 'recordatorio.html'));
router.get('/estados', (req, res) => sendPublicHtml(res, 'estados.html'));
router.get('/biblioteca', (req, res) => sendPublicHtml(res, 'recursos.html'));
router.get('/membresia', (req, res) => sendPublicHtml(res, 'suscripciones.html'));
router.get('/suscripciones', (req, res) => {
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.redirect(301, base + '/membresia');
});
router.get('/guia', (req, res) => sendPublicHtml(res, 'guia-funnel.html'));
router.get('/perfil', (req, res) => sendPublicHtml(res, 'perfil.html'));
router.get('/tarjetas', (req, res) => sendPublicHtml(res, 'tarjetas.html'));
router.get('/encuesta/:slug', (req, res) => sendPublicHtml(res, 'encuesta.html'));
router.get('/recursos', (req, res) => sendPublicHtml(res, 'recursos.html'));
router.get('/calendario', (req, res) => sendPublicHtml(res, 'calendario.html'));
router.get('/comunidad', (req, res) => sendPublicHtml(res, 'comunidad.html'));
router.get('/comunidad.html', (req, res) => sendPublicHtml(res, 'comunidad.html'));

module.exports = router;
