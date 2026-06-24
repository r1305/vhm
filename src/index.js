require('dotenv').config();
const path = require('path');
const fs = require('fs');
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

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

try {
  const compression = require('compression');
  app.use(compression({ threshold: 1024 }));
} catch (_) { /* optional */ }

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : {}));
app.use(express.json());

// Base path para montaje bajo un prefijo (ej. /site)
const BASE_PATH = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
app.use((req, res, next) => {
  res.locals.basePath = BASE_PATH;
  next();
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

app.get('/', (req, res) => sendPublicHtml(res, 'index.html'));

// Fallback para __app_base__.js cuando se corre standalone (sin gateway)
app.get('/__app_base__.js', (req, res) => {
  const base = ((res.locals && res.locals.basePath) || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  res.type('application/javascript').set('Cache-Control', 'no-store').send(`window.__APP_BASE__=${JSON.stringify(base)};`);
});

app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d', index: false }));

app.get('/admin', (req, res) => {
  sendPublicHtml(res, 'admin.html');
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
    res.json(rows[0] || { pixel_id: null, activo: false });
  } catch (err) {
    console.error(err);
    res.json({ pixel_id: null, activo: false });
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

app.use('/api/auth', authRoutes);
app.use('/api/reclamos', reclamosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/config-email', configEmailRoutes);
app.use('/api/config-pixel', configPixelRoutes);
app.use('/api/config-whatsapp', configWhatsappRoutes);
app.use('/api/testimonios', testimoniosRoutes);
app.use('/api/videos', videosRoutes);
app.use('/api/clara', claraRoutes);
app.use('/api/eventos', eventosRoutes);

// Auto-migración: crea las tablas del módulo de videos si faltan.
require('./ensureSchema').ensureVideoSchema()
  .catch((err) => console.error('[vhm] No se pudo asegurar el esquema de videos:', err.message));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
