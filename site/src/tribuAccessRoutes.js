const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const crypto = require('crypto');

const router = Router();

function generarPassword() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // ej: A3F9B2C1
}

async function renovarPassword() {
  const nueva = generarPassword();
  await pool.execute(
    'UPDATE tribu_access SET password = ?, fecha_renovacion = NOW() WHERE id = 1',
    [nueva]
  );
  return nueva;
}

// Pública: verificar contraseña
router.post('/verificar', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT password, activo FROM tribu_access WHERE id = 1');
    const cfg = rows[0];
    if (!cfg || !cfg.activo) return res.json({ ok: true }); // sin bloqueo
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'Contraseña requerida' });
    res.json({ ok: String(password).trim().toUpperCase() === String(cfg.password).toUpperCase() });
  } catch { res.status(500).json({ ok: false, error: 'Error interno' }); }
});

// Pública: obtener config visible (solo si está activo y el mensaje)
router.get('/config-publica', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, mensaje FROM tribu_access WHERE id = 1');
    const cfg = rows[0] || { activo: false, mensaje: '' };
    res.json({ activo: !!cfg.activo, mensaje: cfg.mensaje || '' });
  } catch { res.json({ activo: false, mensaje: '' }); }
});

router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

// GET config completa (admin)
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, password, mensaje, fecha_renovacion FROM tribu_access WHERE id = 1');
    res.json(rows[0] || {});
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

// PUT actualizar config (activo + mensaje)
router.put('/config', requireAdmin, async (req, res) => {
  try {
    const { activo, mensaje } = req.body;
    await pool.execute(
      'UPDATE tribu_access SET activo = ?, mensaje = ? WHERE id = 1',
      [activo ? 1 : 0, mensaje || '']
    );
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar' }); }
});

// POST renovar contraseña manualmente
router.post('/renovar', requireAdmin, async (req, res) => {
  try {
    const nueva = await renovarPassword();
    res.json({ message: 'Contraseña renovada', password: nueva });
  } catch { res.status(500).json({ error: 'Error al renovar' }); }
});

module.exports = { router, renovarPassword };
