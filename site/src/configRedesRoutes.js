const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

// Asegurar tabla
(async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS config_redes (
        id INT PRIMARY KEY DEFAULT 1,
        instagram VARCHAR(300) DEFAULT NULL,
        facebook VARCHAR(300) DEFAULT NULL,
        youtube VARCHAR(300) DEFAULT NULL,
        tiktok VARCHAR(300) DEFAULT NULL,
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const [rows] = await pool.execute('SELECT id FROM config_redes WHERE id = 1');
    if (!rows.length) await pool.execute('INSERT INTO config_redes (id) VALUES (1)');
  } catch (_) {}
})();

// Público — obtener links de redes
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT instagram, facebook, youtube, tiktok FROM config_redes WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) { res.json({}); }
});

// Admin — guardar
router.put('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { instagram, facebook, youtube, tiktok } = req.body;
    await pool.execute(
      'UPDATE config_redes SET instagram=?, facebook=?, youtube=?, tiktok=? WHERE id=1',
      [
        (instagram || '').trim().slice(0, 300) || null,
        (facebook || '').trim().slice(0, 300) || null,
        (youtube || '').trim().slice(0, 300) || null,
        (tiktok || '').trim().slice(0, 300) || null,
      ]
    );
    res.json({ message: 'Redes sociales guardadas correctamente' });
  } catch (err) { res.status(500).json({ error: 'Error al guardar' }); }
});

module.exports = router;
