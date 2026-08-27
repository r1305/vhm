const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { validateMpCredentialsForModo, getMpCredentialInfo } = require('./tribuMpOrders');

const router = Router();

// Ruta pública: solo expone public_key y modo (nunca el access_token)
router.get('/public', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, modo, public_key FROM config_mercadopago WHERE id = 1 AND activo = 1');
    const cfg = rows[0];
    if (!cfg) return res.json({ activo: false });
    const payload = { activo: true, modo: cfg.modo, public_key: cfg.public_key };
    if (cfg.modo === 'sandbox') {
      const email = (process.env.MP_SANDBOX_PAYER_EMAIL || 'test_user_123456789@testuser.com')
        .trim()
        .toLowerCase();
      payload.sandbox_payer_email = email.includes('@testuser.com')
        ? email
        : 'test_user_123456789@testuser.com';
    }
    res.json(payload);
  } catch { res.json({ activo: false }); }
});

router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, modo, public_key, access_token, fecha_actualizacion FROM config_mercadopago WHERE id = 1');
    const cfg = rows[0] || {};
    const modo = cfg.modo || 'sandbox';
    const publicKey = cfg.public_key || '';
    const accessToken = cfg.access_token || '';

    let credenciales_ok = null;
    let credenciales_error = null;
    let mp_live_mode = null;
    let mpInfo = null;
    if (accessToken && publicKey) {
      mpInfo = await getMpCredentialInfo(accessToken);
      if (mpInfo.ok) {
        mp_live_mode = mpInfo.live_mode;
        try {
          await validateMpCredentialsForModo(accessToken, publicKey, modo);
          credenciales_ok = true;
        } catch (err) {
          credenciales_ok = false;
          credenciales_error = err.message;
        }
      } else {
        credenciales_ok = false;
        credenciales_error = mpInfo.error;
      }
    }

    res.json({
      activo: !!cfg.activo,
      modo,
      public_key: publicKey,
      access_token: accessToken,
      fecha_actualizacion: cfg.fecha_actualizacion || null,
      credenciales_ok,
      credenciales_error,
      mp_live_mode,
      is_test_user: mpInfo?.ok ? mpInfo.is_test_user : null,
      mp_email: mpInfo?.ok ? mpInfo.mp_email : null,
      access_token_suffix: accessToken.length >= 8 ? accessToken.slice(-8) : null,
      public_key_prefix: publicKey.length >= 16 ? publicKey.slice(0, 16) : null,
    });
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const { activo, modo, public_key, access_token } = req.body;
    if (!['sandbox', 'produccion'].includes(modo)) return res.status(400).json({ error: 'Modo inválido' });

    const pk = public_key?.trim() || '';
    const token = access_token?.trim() || '';
    if (!pk || !token) {
      return res.status(400).json({
        error: 'Public Key y Access Token son obligatorios. Al usar Sandbox, copia ambos desde "Credenciales de prueba".',
      });
    }

    try {
      await validateMpCredentialsForModo(token, pk, modo);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await pool.execute(
      `INSERT INTO config_mercadopago (id, activo, modo, public_key, access_token)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE activo = VALUES(activo), modo = VALUES(modo),
         public_key = VALUES(public_key), access_token = VALUES(access_token),
         fecha_actualizacion = CURRENT_TIMESTAMP`,
      [activo ? 1 : 0, modo, pk, token]
    );
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

module.exports = router;
