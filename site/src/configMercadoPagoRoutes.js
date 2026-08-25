const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

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
    res.json({
      activo: !!cfg.activo,
      modo: cfg.modo || 'sandbox',
      public_key: cfg.public_key || '',
      access_token: cfg.access_token || '',
      fecha_actualizacion: cfg.fecha_actualizacion || null,
    });
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const { activo, modo, public_key, access_token } = req.body;
    if (!['sandbox', 'produccion'].includes(modo)) return res.status(400).json({ error: 'Modo inválido' });

    // Si no se envía access_token, conservar el existente
    if (access_token !== undefined && access_token !== '') {
      await pool.execute(
        `INSERT INTO config_mercadopago (id, activo, modo, public_key, access_token)
         VALUES (1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE activo = VALUES(activo), modo = VALUES(modo),
           public_key = VALUES(public_key), access_token = VALUES(access_token),
           fecha_actualizacion = CURRENT_TIMESTAMP`,
        [activo ? 1 : 0, modo, public_key?.trim() || '', access_token.trim()]
      );
    } else {
      await pool.execute(
        `INSERT INTO config_mercadopago (id, activo, modo, public_key, access_token)
         VALUES (1, ?, ?, ?, '')
         ON DUPLICATE KEY UPDATE activo = VALUES(activo), modo = VALUES(modo),
           public_key = VALUES(public_key), fecha_actualizacion = CURRENT_TIMESTAMP`,
        [activo ? 1 : 0, modo, public_key?.trim() || '']
      );
    }
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

module.exports = router;
