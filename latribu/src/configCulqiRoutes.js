const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { validateCulqiCredentials, getCulqiCredentialInfo } = require('./tribuCulqi');
const { requireAcceso } = require('./lib/accesos');

const router = Router();

router.get('/public', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, modo, public_key FROM config_culqi WHERE id = 1 AND activo = 1');
    const cfg = rows[0];
    if (!cfg) return res.json({ activo: false });
    res.json({ activo: true, modo: cfg.modo, public_key: cfg.public_key });
  } catch { res.json({ activo: false }); }
});

router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

router.use(requireAdmin, requireAcceso('config'));

function ultimos4(valor) {
  const s = String(valor || '');
  return s.length >= 4 ? s.slice(-4) : '';
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, modo, public_key, secret_key, fecha_actualizacion FROM config_culqi WHERE id = 1');
    const cfg = rows[0] || {};
    const modo = cfg.modo || 'sandbox';
    const publicKey = cfg.public_key || '';
    const secretKey = cfg.secret_key || '';

    let credenciales_ok = null, credenciales_error = null, culqi_live_mode = null, culqiInfo = null;
    if (secretKey && publicKey) {
      culqiInfo = await getCulqiCredentialInfo(secretKey);
      if (culqiInfo.ok) {
        culqi_live_mode = culqiInfo.live_mode;
        try { validateCulqiCredentials(secretKey, publicKey, modo); credenciales_ok = true; }
        catch (err) { credenciales_ok = false; credenciales_error = err.message; }
      } else { credenciales_ok = false; credenciales_error = culqiInfo.error; }
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      activo: !!cfg.activo, modo, public_key: publicKey,
      secret_key_configurada: !!secretKey,
      secret_key_last4: ultimos4(secretKey) || null,
      fecha_actualizacion: cfg.fecha_actualizacion || null,
      credenciales_ok, credenciales_error, culqi_live_mode,
      is_test: culqiInfo?.ok ? culqiInfo.is_test : null,
      public_key_prefix: publicKey.length >= 16 ? publicKey.slice(0, 16) : null,
    });
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const { activo, modo, public_key, secret_key } = req.body;
    if (!['sandbox', 'produccion'].includes(modo)) return res.status(400).json({ error: 'Modo inválido' });
    const pk = public_key?.trim() || '';
    let sk = typeof secret_key === 'string' ? secret_key.trim() : '';
    if (!sk) {
      const [[actual]] = await pool.execute('SELECT secret_key FROM config_culqi WHERE id = 1');
      sk = (actual && actual.secret_key) || '';
    }
    if (!pk || !sk) return res.status(400).json({ error: 'Public Key y Secret Key son obligatorios.' });
    try { validateCulqiCredentials(sk, pk, modo); } catch (err) { return res.status(400).json({ error: err.message }); }
    await pool.execute(
      `INSERT INTO config_culqi (id, activo, modo, public_key, secret_key) VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE activo = VALUES(activo), modo = VALUES(modo),
         public_key = VALUES(public_key), secret_key = VALUES(secret_key), fecha_actualizacion = CURRENT_TIMESTAMP`,
      [activo ? 1 : 0, modo, pk, sk]
    );
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

module.exports = router;
