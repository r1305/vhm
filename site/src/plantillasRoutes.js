const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureVideoSchema } = require('./ensureSchema');
const { ensurePlantillasSchema } = require('./plantillasSchema');

const router = Router();

router.use(async (req, res, next) => {
  try {
    await ensureVideoSchema();
    await ensurePlantillasSchema();
    next();
  } catch {
    res.status(503).json({ error: 'Servicio inicializándose' });
  }
});

router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

function parseFecha(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || '').trim())) return null;
  return String(str).trim();
}

router.get('/eventos', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.fecha, e.orden, e.fecha_creacion,
              COUNT(m.id) AS total_mensajes
       FROM plantilla_eventos e
       LEFT JOIN plantilla_mensajes m ON m.evento_id = e.id
       GROUP BY e.id
       ORDER BY e.fecha DESC, e.orden ASC, e.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

router.post('/eventos', requireAdmin, async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    const fecha = parseFecha(req.body?.fecha);
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha) return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' });

    const [result] = await pool.execute(
      'INSERT INTO plantilla_eventos (nombre, fecha) VALUES (?, ?)',
      [nombre, fecha]
    );
    res.status(201).json({ id: result.insertId, message: 'Evento creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear evento' });
  }
});

router.put('/eventos/:id', requireAdmin, async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    const fecha = parseFecha(req.body?.fecha);
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha) return res.status(400).json({ error: 'Fecha inválida' });

    const [r] = await pool.execute(
      'UPDATE plantilla_eventos SET nombre = ?, fecha = ? WHERE id = ?',
      [nombre, fecha, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar evento' });
  }
});

router.delete('/eventos/:id', requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM plantilla_eventos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
});

router.get('/eventos/:id/mensajes', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, evento_id, titulo, cuerpo, orden, fecha_creacion
       FROM plantilla_mensajes
       WHERE evento_id = ?
       ORDER BY orden ASC, id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

router.post('/eventos/:id/mensajes', requireAdmin, async (req, res) => {
  try {
    const titulo = String(req.body?.titulo || '').trim();
    const cuerpo = String(req.body?.cuerpo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    if (!cuerpo) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

    const [[ev]] = await pool.execute('SELECT id FROM plantilla_eventos WHERE id = ?', [req.params.id]);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });

    const [result] = await pool.execute(
      'INSERT INTO plantilla_mensajes (evento_id, titulo, cuerpo) VALUES (?, ?, ?)',
      [req.params.id, titulo, cuerpo]
    );
    res.status(201).json({ id: result.insertId, message: 'Mensaje creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear mensaje' });
  }
});

router.put('/mensajes/:id', requireAdmin, async (req, res) => {
  try {
    const titulo = String(req.body?.titulo || '').trim();
    const cuerpo = String(req.body?.cuerpo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    if (!cuerpo) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

    const [r] = await pool.execute(
      'UPDATE plantilla_mensajes SET titulo = ?, cuerpo = ? WHERE id = ?',
      [titulo, cuerpo, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Mensaje no encontrado' });
    res.json({ message: 'Mensaje actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar mensaje' });
  }
});

router.delete('/mensajes/:id', requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM plantilla_mensajes WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Mensaje no encontrado' });
    res.json({ message: 'Mensaje eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar mensaje' });
  }
});

module.exports = router;
