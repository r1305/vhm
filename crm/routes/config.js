const { Router } = require('express');
const pool = require('../lib/db');
const { authAdmin } = require('../lib/auth');

const router = Router();

const ALLOWED = new Set([
  'meta_verify_token', 'meta_access_token', 'meta_app_secret',
  'tiktok_app_secret', 'tiktok_verify_token',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'openwa_url', 'openwa_api_key', 'openwa_session',
  'widget_btn_texto',
]);

// Endpoint publico — solo claves no sensibles (sin auth)
router.get('/public', async (req, res) => {
  try {
    const PUBLIC_KEYS = ['widget_btn_texto'];
    const [rows] = await pool.execute(
      `SELECT clave, valor FROM configuracion WHERE clave IN (${PUBLIC_KEYS.map(() => '?').join(',')})`,
      PUBLIC_KEYS
    );
    const data = {};
    for (const r of rows) data[r.clave] = r.valor || '';
    res.json(data);
  } catch { res.json({}); }
});

// Leer config completa (solo admin) — devuelve valores reales
router.get('/', authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT clave, valor FROM configuracion ORDER BY clave');
    const data = {};
    for (const r of rows) data[r.clave] = r.valor || '';
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Guardar claves
router.post('/', authAdmin, async (req, res) => {
  try {
    const entries = req.body || {};
    for (const [k, v] of Object.entries(entries)) {
      if (!ALLOWED.has(k) || v === '') continue;
      await pool.execute(
        'INSERT INTO configuracion (clave, valor) VALUES (?,?) ON DUPLICATE KEY UPDATE valor=?',
        [k, String(v).trim(), String(v).trim()]
      );
    }
    const [rows] = await pool.execute('SELECT clave, valor FROM configuracion');
    for (const r of rows) {
      if (r.clave === 'meta_verify_token')   process.env.META_WEBHOOK_VERIFY_TOKEN   = r.valor || '';
      if (r.clave === 'meta_access_token')   process.env.META_PAGE_ACCESS_TOKEN      = r.valor || '';
      if (r.clave === 'meta_app_secret')     process.env.META_APP_SECRET             = r.valor || '';
      if (r.clave === 'tiktok_app_secret')   process.env.TIKTOK_APP_SECRET           = r.valor || '';
      if (r.clave === 'tiktok_verify_token') process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN = r.valor || '';
      if (r.clave === 'smtp_host')       process.env.SMTP_HOST       = r.valor || '';
      if (r.clave === 'smtp_port')       process.env.SMTP_PORT       = r.valor || '';
      if (r.clave === 'smtp_user')       process.env.SMTP_USER       = r.valor || '';
      if (r.clave === 'smtp_pass')       process.env.SMTP_PASS       = r.valor || '';
      if (r.clave === 'smtp_from')       process.env.SMTP_FROM       = r.valor || '';
      if (r.clave === 'openwa_url')     process.env.OPENWA_URL     = r.valor || '';
      if (r.clave === 'openwa_api_key') process.env.OPENWA_API_KEY = r.valor || '';
      if (r.clave === 'openwa_session') process.env.OPENWA_SESSION = r.valor || '';
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
