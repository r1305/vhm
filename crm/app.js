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

// CORS
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
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return cb(null, true);
    cb(new Error('CORS no permitido'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos — accesibles desde BASE/
app.use(BASE, express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));

// Inyecta __APP_BASE__ en el HTML
function sendHtml(res, file) {
  const fs = require('fs');
  const fp = path.join(__dirname, 'public', file);
  if (!fs.existsSync(fp)) return res.status(404).send('Not found');
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/(<head[^>]*>)/i,
    `$1\n  <script>window.__APP_BASE__=${JSON.stringify(BASE)};</script>`);
  res.type('html').send(html);
}

// ── Router montado bajo BASE ──────────────────────────────────
const router = express.Router();

router.get('/health', (_, res) => res.json({ ok: true, service: 'vhm-crm' }));

const leadsRouter = require('./routes/leads');
router.get ('/api/leads/webhook/meta',   leadsRouter);
router.post('/api/leads/webhook/meta',   leadsRouter);
router.post('/api/leads/webhook/tiktok', leadsRouter);
router.post('/api/leads/web',            leadsRouter);

const citasRouter = require('./routes/citas');
router.post('/api/citas/agendar',     citasRouter);
router.get ('/api/citas/disponibles', citasRouter);

router.use('/api/auth',       require('./routes/auth'));
router.use('/api/terapeutas', require('./routes/terapeutas'));
router.use('/api/pacientes',  require('./routes/pacientes'));
router.use('/api/citas',      citasRouter);
router.use('/api/historial',  require('./routes/historial'));
router.use('/api/leads',      leadsRouter);
router.use('/api/pagos',      require('./routes/pagos'));
router.use('/api/reportes',   require('./routes/reportes'));
router.use('/api/marketing',  require('./routes/marketing'));

router.get('/', (req, res) => sendHtml(res, 'index.html'));
router.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Ruta no encontrada' });
  sendHtml(res, 'index.html');
});

app.use(BASE, router);

// Redirigir raíz al panel
app.get('/', (_, res) => res.redirect(BASE + '/'));

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
