const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

// Pública: pixel
router.get('/pixel-config', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT pixel_id, pixel_activo AS activo FROM tribu_config WHERE id = 1');
    const r = rows[0] || {};
    res.json({ pixel_id: r.activo ? r.pixel_id : null, activo: !!r.activo });
  } catch { res.json({ pixel_id: null, activo: false }); }
});

// Pública: whatsapp
router.get('/whatsapp-config', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT whatsapp_numero AS numero, whatsapp_mensaje AS mensaje, whatsapp_activo AS activo FROM tribu_config WHERE id = 1');
    const r = rows[0] || {};
    if (!r.activo) return res.json({ numero: null, mensaje: null, activo: false });
    res.json({ numero: r.numero, mensaje: r.mensaje, activo: true });
  } catch { res.json({ numero: null, mensaje: null, activo: false }); }
});

// Pública: redes
router.get('/redes', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT instagram, facebook, youtube, tiktok FROM tribu_config WHERE id = 1');
    res.json(rows[0] || {});
  } catch { res.json({}); }
});

// Admin: GET config completa
router.get('/config', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM tribu_config WHERE id = 1');
    res.json(rows[0] || {});
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

// Admin: PUT config completa
router.put('/config', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const {
      pixel_id, pixel_activo,
      whatsapp_numero, whatsapp_mensaje, whatsapp_activo,
      instagram, facebook, youtube, tiktok,
    } = req.body;
    await pool.execute(
      `UPDATE tribu_config SET
        pixel_id = ?, pixel_activo = ?,
        whatsapp_numero = ?, whatsapp_mensaje = ?, whatsapp_activo = ?,
        instagram = ?, facebook = ?, youtube = ?, tiktok = ?
       WHERE id = 1`,
      [
        pixel_id || null, pixel_activo ? 1 : 0,
        whatsapp_numero || null, whatsapp_mensaje || null, whatsapp_activo ? 1 : 0,
        instagram || null, facebook || null, youtube || null, tiktok || null,
      ]
    );
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

module.exports = router;
