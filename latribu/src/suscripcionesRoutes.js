const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

router.get('/public', async (req, res) => {
  try {
    const [cfg] = await pool.execute('SELECT activo, visible FROM config_suscripciones WHERE id = 1');
    const row = cfg[0];
    const activo = !!row?.activo, visible = !!row?.visible;
    if (!activo) return res.json({ activo: false, visible, data: [] });
    const [rows] = await pool.execute('SELECT id, nombre, precio, descripcion FROM suscripciones ORDER BY id ASC');
    res.json({ activo: true, visible, data: rows });
  } catch { res.json({ activo: false, visible: false, data: [] }); }
});

router.use(authMiddleware);

router.get('/config', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT activo, visible FROM config_suscripciones WHERE id = 1');
    res.json({ activo: rows[0]?.activo ?? false, visible: rows[0]?.visible ?? false });
  } catch { res.status(500).json({ error: 'Error al obtener configuración' }); }
});

router.put('/config', requireAdmin, async (req, res) => {
  try {
    const { activo, visible } = req.body;
    await pool.execute('UPDATE config_suscripciones SET activo = ?, visible = ? WHERE id = 1', [activo ? 1 : 0, visible ? 1 : 0]);
    res.json({ message: 'Configuración guardada' });
  } catch { res.status(500).json({ error: 'Error al guardar configuración' }); }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM suscripciones ORDER BY id ASC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener suscripciones' }); }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { nombre, precio, descripcion, vigencia_dias } = req.body;
    if (!nombre || precio == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    const [result] = await pool.execute(
      'INSERT INTO suscripciones (nombre, precio, descripcion, vigencia_dias) VALUES (?, ?, ?, ?)',
      [nombre.trim(), parseFloat(precio), descripcion?.trim() || null, parseInt(vigencia_dias) || 30]
    );
    res.status(201).json({ id: result.insertId, nombre, precio, descripcion, vigencia_dias });
  } catch { res.status(500).json({ error: 'Error al crear suscripción' }); }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, precio, descripcion, vigencia_dias } = req.body;
    if (!nombre || precio == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    const [result] = await pool.execute(
      'UPDATE suscripciones SET nombre = ?, precio = ?, descripcion = ?, vigencia_dias = ? WHERE id = ?',
      [nombre.trim(), parseFloat(precio), descripcion?.trim() || null, parseInt(vigencia_dias) || 30, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json({ message: 'Plan actualizado' });
  } catch { res.status(500).json({ error: 'Error al actualizar suscripción' }); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM suscripciones WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json({ message: 'Plan eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar suscripción' }); }
});

module.exports = router;
