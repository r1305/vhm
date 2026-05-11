const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();
router.use(authMiddleware);

function soloSuperAdmin(req, res, next) {
  if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido al Super Admin' });
  next();
}

// Obtener configuración del pixel
router.get('/', soloSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT pixel_id, activo, fecha_actualizacion FROM config_pixel WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener configuración del pixel' });
  }
});

// Guardar configuración del pixel
router.put('/', soloSuperAdmin, async (req, res) => {
  try {
    const { pixel_id, activo } = req.body;
    
    // Validar que el pixel_id sea numérico si se proporciona
    if (pixel_id && !/^\d+$/.test(pixel_id)) {
      return res.status(400).json({ error: 'El ID del pixel debe ser numérico' });
    }

    // Verificar si ya existe una configuración
    const [existing] = await pool.execute('SELECT id FROM config_pixel WHERE id = 1');
    
    if (existing.length > 0) {
      // Actualizar configuración existente
      await pool.execute(
        'UPDATE config_pixel SET pixel_id = ?, activo = ?, fecha_actualizacion = NOW() WHERE id = 1',
        [pixel_id || null, activo ? 1 : 0]
      );
    } else {
      // Crear nueva configuración
      await pool.execute(
        'INSERT INTO config_pixel (id, pixel_id, activo, fecha_actualizacion) VALUES (1, ?, ?, NOW())',
        [pixel_id || null, activo ? 1 : 0]
      );
    }

    res.json({ message: 'Configuración del pixel guardada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración del pixel' });
  }
});

module.exports = router;