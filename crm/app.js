require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');

const { ensureSchema } = require('./schema');

const app  = express();
const BASE = (process.env.APP_MOUNT_PATH || '/crm').replace(/\/$/, '');

app.set('trust proxy', 1);

try { app.use(require('compression')({ threshold: 1024 })); } catch (_) {}

// CORS — permite el propio dominio, vhm.com.pe y localhost en desarrollo
const allowedOrigins = [
  'https://vhm.com.pe',
  'https://www.vhm.com.pe',
  'http://localhost:3001',
  'http://localhost:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3000',
  ...(process.env.CORS_EXTRA || '').split(',').map(o => o.trim()).filter(Boolean),
];
app.use(cors({
  origin: (origin, cb) => {
    // sin origin = petición directa (curl, Postman, mismo proceso)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // en desarrollo permitir cualquier localhost
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return cb(null, true);
    cb(new Error('CORS no permitido'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Sirve el panel admin (SPA)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));

// Inyecta __APP_BASE__ en el HTML
function sendHtml(res, file) {
  const fs  = require('fs');
  const fp  = path.join(__dirname, 'public', file);
  if (!fs.existsSync(fp)) return res.status(404).send('Not found');
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/(<head[^>]*>)/i,
    `$1\n  <script>window.__APP_BASE__=${JSON.stringify(BASE)};</script>`);
  res.type('html').send(html);
}

// ── Rutas públicas (sin auth) ─────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, service: 'vhm-crm' }));

// Webhooks de redes sociales — antes del panel
const leadsRouter = require('./routes/leads');
app.get ('/api/leads/webhook/meta',    leadsRouter);  // verificación Meta
app.post('/api/leads/webhook/meta',    leadsRouter);  // eventos Meta
app.post('/api/leads/webhook/tiktok',  leadsRouter);  // eventos TikTok
app.post('/api/leads/web',             leadsRouter);  // formulario vhm.com.pe

// Auto-agendamiento público
const citasRouter = require('./routes/citas');
app.post('/api/citas/agendar',      citasRouter);
app.get ('/api/citas/disponibles',  citasRouter);

// ── API protegida ─────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/terapeutas', require('./routes/terapeutas'));
app.use('/api/pacientes',  require('./routes/pacientes'));
app.use('/api/citas',      citasRouter);
app.use('/api/historial',  require('./routes/historial'));
app.use('/api/leads',      leadsRouter);
app.use('/api/pagos',      require('./routes/pagos'));
app.use('/api/reportes',   require('./routes/reportes'));

// ── Panel admin (SPA catch-all) ───────────────────────────────
app.get('/', (req, res) => sendHtml(res, 'index.html'));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Ruta no encontrada' });
  sendHtml(res, 'index.html');
});

// ── Arranque ──────────────────────────────────────────────────
ensureSchema().catch(err => console.error('[crm] Schema error:', err.message));

if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
  app.listen('passenger');
} else if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`[vhm-crm] http://localhost:${PORT}${BASE}/`));
}

module.exports = app;
