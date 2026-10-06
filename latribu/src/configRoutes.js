const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { trialDaysFromEnv, formatRenewalDateLima } = require('../lib/tribuFunnel');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

// Pública: oferta del funnel (trial + plan principal)
router.get('/funnel', async (req, res) => {
  try {
    const trialDays = trialDaysFromEnv();
    const [cfg] = await pool.execute('SELECT activo, visible FROM config_suscripciones WHERE id = 1');
    const susActivo = !!cfg[0]?.activo;
    const [plans] = await pool.execute(
      'SELECT id, nombre, precio, descripcion, vigencia_dias FROM suscripciones ORDER BY precio ASC, id ASC LIMIT 1'
    );
    const plan = plans[0] || null;
    res.json({
      trial_dias: trialDays,
      precio_hoy: 0,
      precio_mensual: plan ? Number(plan.precio) : 39.9,
      fecha_renovacion_ejemplo: formatRenewalDateLima(trialDays),
      suscripciones_activas: susActivo,
      plan,
    });
  } catch {
    res.json({
      trial_dias: trialDaysFromEnv(),
      precio_hoy: 0,
      precio_mensual: 39.9,
      fecha_renovacion_ejemplo: formatRenewalDateLima(),
      suscripciones_activas: false,
      plan: null,
    });
  }
});

// Pública: beneficios
router.get('/beneficios', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT beneficios FROM tribu_config WHERE id = 1');
    const raw = rows[0]?.beneficios;
    const items = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    res.json(Array.isArray(items) ? items : []);
  } catch { res.json([]); }
});

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
      beneficios,
    } = req.body;
    const beneficiosJson = beneficios !== undefined
      ? JSON.stringify(Array.isArray(beneficios) ? beneficios : [])
      : null;
    await pool.execute(
      `UPDATE tribu_config SET
        pixel_id = ?, pixel_activo = ?,
        whatsapp_numero = ?, whatsapp_mensaje = ?, whatsapp_activo = ?,
        instagram = ?, facebook = ?, youtube = ?, tiktok = ?
        ${beneficiosJson !== null ? ', beneficios = ?' : ''}
       WHERE id = 1`,
      [
        pixel_id || null, pixel_activo ? 1 : 0,
        whatsapp_numero || null, whatsapp_mensaje || null, whatsapp_activo ? 1 : 0,
        instagram || null, facebook || null, youtube || null, tiktok || null,
        ...(beneficiosJson !== null ? [beneficiosJson] : []),
      ]
    );
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

module.exports = router;
