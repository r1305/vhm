require('dotenv').config();
const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');
const session = require('express-session');

const { ensureSchema } = require('./schema');
const { getHomePath } = require('./lib/crmNav');

const app  = express();
const BASE = (process.env.APP_MOUNT_PATH || '/crm').replace(/\/$/, '');
const ASSET_VERSION = process.env.CRM_ASSET_VERSION || '20250828a';

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.BASE = BASE;
app.locals.assetVersion = ASSET_VERSION;

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

app.use(session({
  secret: process.env.SESSION_SECRET || 'crm_session_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 10 * 60 * 60 * 1000 }, // 10h
}));

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

// Rutas MPA (páginas)
app.use(BASE, require('./routes/pages'));

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
router.use('/api/bloqueos',    require('./routes/bloqueos'));
router.use('/api/publico',     require('./routes/publico'));
router.use('/api/historial',  require('./routes/historial'));
router.use('/api/leads',      leadsRouter);
router.use('/api/pagos',      require('./routes/pagos'));
router.use('/api/reportes',   require('./routes/reportes'));
router.use('/api/marketing',  require('./routes/marketing'));
router.use('/api/config',     require('./routes/config'));
router.use('/api/track',      require('./routes/tracker'));

// Cron config
router.get('/api/cron/config', require('./lib/auth').authAdmin, async (req, res) => {
  try {
    const db = require('./lib/db');
    const [[row]] = await db.execute('SELECT enabled, hora, minuto, dias, mensaje FROM cron_config WHERE id=1');
    res.json(row || { enabled: 0, hora: 18, minuto: 0, dias: '1,2,3,4,5,6', mensaje: '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cron/config', require('./lib/auth').authAdmin, async (req, res) => {
  try {
    const db = require('./lib/db');
    const { enabled, hora, minuto, dias, mensaje } = req.body;
    const mensajeVal = mensaje != null ? String(mensaje).trim().slice(0, 4000) : null;
    await db.execute(
      'UPDATE cron_config SET enabled=?, hora=?, minuto=?, dias=?, mensaje=? WHERE id=1',
      [enabled ? 1 : 0, Number(hora), Number(minuto), dias, mensajeVal || null]
    );
    scheduleCron();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cron/ejecutar', require('./lib/auth').authAdmin, async (req, res) => {
  try {
    const stats = await require('./cron-wsp').runCronWSP({ manual: true });
    res.json({ ok: true, message: 'Cron ejecutado', ...stats });
  } catch (err) {
    console.error('[cron manual]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/cron/broadcast', require('./lib/auth').authAdmin, async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message requerido' });
  try {
    const { sendBroadcastToTerapeutas } = require('./cron-wsp');
    const { loadOpenwaConfigFromDB, isOpenwaConfigured } = require('./lib/greenapi');
    await loadOpenwaConfigFromDB();
    if (!isOpenwaConfigured()) return res.json({ ok: true, enviados: 0, omitidos: 0, sinConfig: true });
    const stats = await sendBroadcastToTerapeutas(message.trim());
    res.json({ ok: true, ...stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

router.get('/', (req, res) => res.redirect(`${BASE}/${getHomePath(req.session?.user)}`));
router.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.redirect(`${BASE}/${getHomePath(req.session?.user)}`);
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

// ── Scheduler node-cron ─────────────────────────────────────────
let _cronTask = null;
async function scheduleCron() {
  try {
    const nodeCron = require('node-cron');
    const db = require('./lib/db');
    const [[cfg]] = await db.execute('SELECT enabled, hora, minuto, dias FROM cron_config WHERE id=1');
    if (_cronTask) { _cronTask.stop(); _cronTask = null; }
    if (!cfg || !cfg.enabled) { console.log('[cron] Desactivado (enabled=' + (cfg?.enabled) + ')'); return; }
    const expr = `${cfg.minuto} ${cfg.hora} * * ${cfg.dias}`;
    _cronTask = nodeCron.schedule(expr, () => {
      console.log('[cron] Ejecutando cron-wsp...');
      require('./cron-wsp').runCronWSP().catch(e => console.error('[cron]', e.message));
    }, { timezone: 'America/Lima' });
    console.log(`[cron] Programado OK: ${expr} (America/Lima) — enabled=${cfg.enabled}`);
  } catch (err) {
    console.warn('[cron] node-cron no disponible:', err.message);
  }
}

ensureSchema()
  .then(() => loadConfigFromDB())
  .then(async () => {
    // Generar íconos PWA si no existen o son inválidos
    try {
      const fs = require('fs');
      const zlib = require('zlib');
      const iconDir = path.join(__dirname, 'public', 'icons');
      if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });
      function crc32(buf) {
        let c = 0xFFFFFFFF;
        const t = [];
        for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = (v&1)?0xEDB88320^(v>>>1):v>>>1; t[i]=v; }
        for (let i = 0; i < buf.length; i++) c = t[(c^buf[i])&0xFF]^(c>>>8);
        return (c^0xFFFFFFFF)>>>0;
      }
      function pngChunk(type, data) {
        const t=Buffer.from(type,'ascii'), len=Buffer.alloc(4), crc=Buffer.alloc(4);
        len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t,data])));
        return Buffer.concat([len,t,data,crc]);
      }
      function makePNG(size) {
        const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=2;
        const row=Buffer.alloc(1+size*3); row[0]=0;
        for(let x=0;x<size;x++){row[1+x*3]=124;row[2+x*3]=58;row[3+x*3]=237;}
        const raw=Buffer.concat(Array(size).fill(row));
        return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
      }
      for (const size of [192, 512]) {
        const fp = path.join(iconDir, `icon-${size}.png`);
        const buf = fs.existsSync(fp) ? fs.readFileSync(fp) : Buffer.alloc(0);
        const valid = buf.length > 100 && buf.slice(0,4).toString('hex') === '89504e47';
        if (!valid) { fs.writeFileSync(fp, makePNG(size)); console.log(`[pwa] icon-${size}.png generado`); }
      }
    } catch (err) { console.warn('[pwa] No se pudieron generar íconos:', err.message); }
    await scheduleCron();
  })
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
