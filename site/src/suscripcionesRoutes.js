const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

// Pública: obtener planes activos + visibilidad
router.get('/public', async (req, res) => {
  try {
    const [cfg] = await pool.execute('SELECT activo FROM config_suscripciones WHERE id = 1');
    const visible = cfg[0]?.activo ?? false;
    if (!visible) return res.json({ visible: false, data: [] });
    const [rows] = await pool.execute('SELECT id, nombre, precio, descripcion FROM suscripciones ORDER BY id ASC');
    res.json({ visible: true, data: rows });
  } catch { res.json({ visible: false, data: [] }); }
});

router.use(authMiddleware);

// GET config visibilidad
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo FROM config_suscripciones WHERE id = 1');
    res.json({ activo: rows[0]?.activo ?? false });
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

// PUT config visibilidad
router.put('/config', requireAdmin, async (req, res) => {
  try {
    const { activo } = req.body;
    await pool.execute('UPDATE config_suscripciones SET activo = ? WHERE id = 1', [activo ? 1 : 0]);
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

// GET todos los planes
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM suscripciones ORDER BY id ASC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener suscripciones' }); }
});

// POST crear plan
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { nombre, precio, descripcion } = req.body;
    if (!nombre || precio == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    const [result] = await pool.execute(
      'INSERT INTO suscripciones (nombre, precio, descripcion) VALUES (?, ?, ?)',
      [nombre.trim(), parseFloat(precio), descripcion?.trim() || null]
    );
    res.status(201).json({ id: result.insertId, nombre, precio, descripcion });
  } catch { res.status(500).json({ error: 'Error al crear suscripción' }); }
});

// PUT editar plan
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, precio, descripcion } = req.body;
    if (!nombre || precio == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    const [result] = await pool.execute(
      'UPDATE suscripciones SET nombre = ?, precio = ?, descripcion = ? WHERE id = ?',
      [nombre.trim(), parseFloat(precio), descripcion?.trim() || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json({ message: 'Plan actualizado' });
  } catch { res.status(500).json({ error: 'Error al actualizar suscripción' }); }
});

// DELETE eliminar plan
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM suscripciones WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json({ message: 'Plan eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar suscripción' }); }
});

module.exports = router;
