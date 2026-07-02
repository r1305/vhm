const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

// GET - Obtener configuración
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT facebook_domain_verification, fecha_actualizacion FROM config_facebook_verification WHERE id = 1'
    );
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuración de verificación de Facebook' });
  }
});

// PUT - Guardar configuración
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { facebook_domain_verification } = req.body;
    const valor = (facebook_domain_verification || '').trim();

    // Asegurar que la tabla exista
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS config_facebook_verification (
        id INT PRIMARY KEY DEFAULT 1,
        facebook_domain_verification VARCHAR(100) DEFAULT NULL,
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [existing] = await pool.execute('SELECT id FROM config_facebook_verification WHERE id = 1');
    if (existing.length > 0) {
      await pool.execute(
        'UPDATE config_facebook_verification SET facebook_domain_verification=?, fecha_actualizacion=NOW() WHERE id=1',
        [valor || null]
      );
    } else {
      await pool.execute(
        'INSERT INTO config_facebook_verification (id, facebook_domain_verification) VALUES (1, ?)',
        [valor || null]
      );
    }
    res.json({ message: 'Verificación de dominio de Facebook guardada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar verificación de Facebook' });
  }
});

// RUTA PÚBLICA - para que la landing lea el valor sin autenticación
router.get('/public', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT facebook_domain_verification FROM config_facebook_verification WHERE id = 1 AND facebook_domain_verification IS NOT NULL AND facebook_domain_verification != \'\''
    );
    res.json({ value: rows[0]?.facebook_domain_verification || null });
  } catch (err) {
    res.json({ value: null });
  }
});

module.exports = router;
