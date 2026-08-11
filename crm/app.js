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

app.use(BASE, express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));

function sendHtml(res, file) {
  const fs = require('fs');
  const fp = path.join(__dirname, 'public', file);
  if (!fs.existsSync(fp)) return res.status(404).send('Not found');
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/(<head[^>]*>)/i,
    `$1\n  <script>window.__APP_BASE__=${JSON.stringify(BASE)};</script>`);
  res.type('html').send(html);
}

// Config publica (sin auth) — debe ir antes del router principal
app.get(`${BASE}/api/config/public`, require('./routes/config'));

const router = express.Router();

router.get('/health', (_, res) => res.json({ ok: true, service: 'vhm-crm' }));

const leadsRouter = require('./routes/leads');
router.get ('/api/leads/webhook/meta',   leadsRouter);
router.post('/api/leads/webhook/meta',   leadsRouter);
router.post('/api/leads/webhook/tiktok', leadsRouter);
router.post('/api/leads/web',            leadsRouter);

// Suscripcion publica newsletter
router.post('/api/marketing/suscribir', require('./routes/marketing'));

const citasRouter = require('./routes/citas');
router.post('/api/citas/agendar',     citasRouter);
router.get ('/api/citas/disponibles', citasRouter);

// Tracker web — publico (sin auth)
router.post('/api/track/sesion', require('./routes/tracker'));
router.post('/api/track/evento', require('./routes/tracker'));

router.use('/api/auth',       require('./routes/auth'));
router.use('/api/terapeutas', require('./routes/terapeutas'));
router.use('/api/pacientes',  require('./routes/pacientes'));
router.use('/api/citas',      citasRouter);
router.use('/api/historial',  require('./routes/historial'));
router.use('/api/leads',      leadsRouter);
router.use('/api/pagos',      require('./routes/pagos'));
router.use('/api/reportes',   require('./routes/reportes'));
router.use('/api/marketing',  require('./routes/marketing'));
router.use('/api/config',     require('./routes/config'));
router.use('/api/track',      require('./routes/tracker'));

// Test WhatsApp openwa
router.post('/api/whatsapp/test', require('./lib/auth').authAdmin, async (req, res) => {
  const { sendWhatsAppGreen } = require('./lib/greenapi');
  const { to, message } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: 'to y message requeridos' });
  try {
    const result = await sendWhatsAppGreen({ to, message });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', (req, res) => sendHtml(res, 'index.html'));
router.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Ruta no encontrada' });
  sendHtml(res, 'index.html');
});

app.use(BASE, router);
app.get('/', (_, res) => res.redirect(BASE + '/'));

// Cargar config de BD al arrancar (webhook tokens, SMTP, WA)
async function loadConfigFromDB() {
  try {
    const dbPool = require('./lib/db');
    const [rows] = await dbPool.execute('SELECT clave, valor FROM configuracion');
    const map = {
      meta_verify_token:   'META_WEBHOOK_VERIFY_TOKEN',
      meta_access_token:   'META_PAGE_ACCESS_TOKEN',
      meta_app_secret:     'META_APP_SECRET',
      tiktok_app_secret:   'TIKTOK_APP_SECRET',
      tiktok_verify_token: 'TIKTOK_WEBHOOK_VERIFY_TOKEN',
      smtp_host:    'SMTP_HOST',    smtp_port:   'SMTP_PORT',
      smtp_user:    'SMTP_USER',    smtp_pass:   'SMTP_PASS',
      smtp_from:    'SMTP_FROM',    smtp_secure: 'SMTP_SECURE',
      sms_gateway_url:   'SMS_GATEWAY_URL',
      sms_gateway_token: 'SMS_GATEWAY_TOKEN',
      sms_gateway_type:  'SMS_GATEWAY_TYPE',
      openwa_url:     'OPENWA_URL',
      openwa_api_key: 'OPENWA_API_KEY',
      openwa_session: 'OPENWA_SESSION',
    };
    for (const r of rows) {
      if (r.valor && map[r.clave]) process.env[map[r.clave]] = r.valor;
    }
    console.log('[crm] Config cargada desde BD');
  } catch (err) {
    console.warn('[crm] No se pudo cargar config:', err.message);
  }
}

ensureSchema()
  .then(() => loadConfigFromDB())
  .then(() => {
    if (typeof PhusionPassenger !== 'undefined') {
      PhusionPassenger.configure({ autoInstall: false });
      app.listen('passenger');
    } else if (require.main === module) {
      const PORT = process.env.PORT || 3001;
      app.listen(PORT, () => console.log(`[vhm-crm] http://localhost:${PORT}${BASE}/`));
    }
  })
  .catch(err => console.error('[crm] Init error:', err.message));

module.exports = app;
