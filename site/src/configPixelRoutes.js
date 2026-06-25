const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT pixel_id, activo, fecha_actualizacion FROM config_pixel WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) { res.status(500).json({ error: 'Error al obtener configuración del pixel' }); }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const { pixel_id, activo } = req.body;
    if (pixel_id && !/^\d+$/.test(pixel_id))
      return res.status(400).json({ error: 'El ID del pixel debe ser numérico' });

    const [existing] = await pool.execute('SELECT id FROM config_pixel WHERE id = 1');
    if (existing.length > 0) {
      await pool.execute('UPDATE config_pixel SET pixel_id=?, activo=?, fecha_actualizacion=NOW() WHERE id=1',
        [pixel_id || null, activo ? 1 : 0]);
    } else {
      await pool.execute('INSERT INTO config_pixel (id, pixel_id, activo, fecha_actualizacion) VALUES (1,?,?,NOW())',
        [pixel_id || null, activo ? 1 : 0]);
    }
    res.json({ message: 'Configuración del pixel guardada correctamente' });
  } catch (err) { res.status(500).json({ error: 'Error al guardar configuración del pixel' }); }
});

module.exports = router;
