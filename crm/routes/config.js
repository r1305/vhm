const env = require('../lib/env');
const { Router } = require('express');
const pool = require('../lib/db');
const { requireMenuPermisoApi } = require('../lib/menuPermisos');
const { esSecreto, esMascara, configParaCliente } = require('../lib/configSecretos');

const router = Router();

const ALLOWED = new Set([
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'openwa_url', 'openwa_api_key', 'openwa_session', 'openwa_webhook_token',
  'meta_app_id', 'meta_app_secret', 'meta_verify_token',
  'recordatorio_24h_activo', 'recordatorio_24h_mensaje',
]);

router.get('/', requireMenuPermisoApi('integraciones'), async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT clave, valor FROM configuracion ORDER BY clave');
    res.json(configParaCliente(rows));
  } catch (err) {
    console.error('[config/leer]:', err);
    res.status(500).json({ error: 'No se pudo cargar la configuración. Inténtalo nuevamente.' });
  }
});

// Guardar claves
router.post('/', requireMenuPermisoApi('integraciones'), async (req, res) => {
  try {
    const entries = req.body || {};
    for (const [k, v] of Object.entries(entries)) {
      if (!ALLOWED.has(k) || v == null || v === '') continue;
      if (esSecreto(k) && (String(v).trim() === '' || esMascara(v))) continue;
      await pool.execute(
        'INSERT INTO configuracion (clave, valor) VALUES (?,?) ON DUPLICATE KEY UPDATE valor=?',
        [k, String(v).trim(), String(v).trim()]
      );
    }
    const [rows] = await pool.execute('SELECT clave, valor FROM configuracion');
    for (const r of rows) {
      if (r.clave === 'smtp_host')       env.set('SMTP_HOST', r.valor || '');
      if (r.clave === 'smtp_port')       env.set('SMTP_PORT', r.valor || '');
      if (r.clave === 'smtp_user')       env.set('SMTP_USER', r.valor || '');
      if (r.clave === 'smtp_pass')       env.set('SMTP_PASS', r.valor || '');
      if (r.clave === 'smtp_from')       env.set('SMTP_FROM', r.valor || '');
      if (r.clave === 'meta_app_id')           env.set('META_APP_ID', r.valor || '');
      if (r.clave === 'meta_app_secret')       env.set('META_APP_SECRET', r.valor || '');
      if (r.clave === 'meta_verify_token')     env.set('META_VERIFY_TOKEN', r.valor || '');
      if (r.clave === 'openwa_url')            env.set('OPENWA_URL', r.valor || '');
      if (r.clave === 'openwa_api_key')        env.set('OPENWA_API_KEY', r.valor || '');
      if (r.clave === 'openwa_session')        env.set('OPENWA_SESSION', r.valor || '');
      if (r.clave === 'openwa_webhook_token')  env.set('OPENWA_WEBHOOK_TOKEN', r.valor || '');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[config/guardar]:', err);
    res.status(500).json({ error: 'No se pudo guardar la configuración. Inténtalo nuevamente.' });
  }
});

module.exports = router;
