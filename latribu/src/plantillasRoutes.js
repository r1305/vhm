const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureSchema } = require('./schema');
const { crearUploadImagen, guardarImagen, borrarImagen } = require('./lib/subidaImagen');

const router = Router();

router.use(async (req, res, next) => {
  try { await ensureSchema(); next(); }
  catch { res.status(503).json({ error: 'Servicio inicializándose' }); }
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

// ── Multer para fotos de plantillas ──
// Las fotos viven en public/uploads/ sin subcarpeta, como antes.
const DESTINO = '';
const ASSET_BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
const upload = crearUploadImagen({ limiteBytes: 8 * 1024 * 1024 });

const uploadFoto = (req, res, next) =>
  upload.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Archivo no válido' });
    next();
  });

async function guardarFoto(file) {
  return (await guardarImagen(file, { destino: DESTINO, prefijo: 'plantilla', assetBase: ASSET_BASE })).url;
}

function deleteFile(url) {
  borrarImagen(url, DESTINO);
}

// ── Eventos ──
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener eventos' }); }
});

router.post('/eventos', requireAdmin, async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    const fecha = parseFecha(req.body?.fecha);
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha) return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' });
    const [result] = await pool.execute(
      'INSERT INTO plantilla_eventos (nombre, fecha) VALUES (?, ?)', [nombre, fecha]
    );
    res.status(201).json({ id: result.insertId, message: 'Evento creado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear evento' }); }
});

router.put('/eventos/:id', requireAdmin, async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    const fecha = parseFecha(req.body?.fecha);
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha) return res.status(400).json({ error: 'Fecha inválida' });
    const [r] = await pool.execute(
      'UPDATE plantilla_eventos SET nombre = ?, fecha = ? WHERE id = ?', [nombre, fecha, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento actualizado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar evento' }); }
});

router.delete('/eventos/:id', requireAdmin, async (req, res) => {
  try {
    // Borrar fotos de mensajes del evento antes de eliminar
    const [msgs] = await pool.execute('SELECT foto_url FROM plantilla_mensajes WHERE evento_id = ?', [req.params.id]);
    msgs.forEach(m => deleteFile(m.foto_url));
    const [r] = await pool.execute('DELETE FROM plantilla_eventos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar evento' }); }
});

// ── Mensajes ──
router.get('/eventos/:id/mensajes', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, evento_id, titulo, cuerpo, foto_url, orden, fecha_creacion
       FROM plantilla_mensajes WHERE evento_id = ? ORDER BY orden ASC, id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener mensajes' }); }
});

router.post('/eventos/:id/mensajes', requireAdmin, uploadFoto, async (req, res) => {
  let guardada = null;
  try {
    const titulo = String(req.body?.titulo || '').trim();
    const cuerpo = String(req.body?.cuerpo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    if (!cuerpo) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    const [[ev]] = await pool.execute('SELECT id FROM plantilla_eventos WHERE id = ?', [req.params.id]);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
    if (req.file) guardada = await guardarFoto(req.file);
    const foto_url = guardada;
    const [result] = await pool.execute(
      'INSERT INTO plantilla_mensajes (evento_id, titulo, cuerpo, foto_url) VALUES (?, ?, ?, ?)',
      [req.params.id, titulo, cuerpo, foto_url]
    );
    res.status(201).json({ id: result.insertId, foto_url, message: 'Mensaje creado' });
  } catch (err) {
    if (guardada) deleteFile(guardada);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error al crear mensaje' });
  }
});

router.put('/mensajes/:id', requireAdmin, uploadFoto, async (req, res) => {
  let guardada = null;
  try {
    const titulo = String(req.body?.titulo || '').trim();
    const cuerpo = String(req.body?.cuerpo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    if (!cuerpo) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    const [[existing]] = await pool.execute('SELECT foto_url FROM plantilla_mensajes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Mensaje no encontrado' });
    let foto_url = existing.foto_url;
    // La anterior se borra solo cuando el UPDATE ya funciono.
    if (req.file) {
      guardada = await guardarFoto(req.file);
      foto_url = guardada;
    }
    const [r] = await pool.execute(
      'UPDATE plantilla_mensajes SET titulo = ?, cuerpo = ?, foto_url = ? WHERE id = ?',
      [titulo, cuerpo, foto_url, req.params.id]
    );
    if (!r.affectedRows) {
      if (guardada) deleteFile(guardada);
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    if (req.file && existing.foto_url) deleteFile(existing.foto_url);
    res.json({ message: 'Mensaje actualizado', foto_url });
  } catch (err) {
    if (guardada) deleteFile(guardada);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar mensaje' });
  }
});

// Subir/reemplazar foto de un mensaje existente
router.post('/mensajes/:id/foto', requireAdmin, uploadFoto, async (req, res) => {
  let guardada = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    const [[existing]] = await pool.execute('SELECT foto_url FROM plantilla_mensajes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Mensaje no encontrado' });
    guardada = await guardarFoto(req.file);
    await pool.execute('UPDATE plantilla_mensajes SET foto_url = ? WHERE id = ?', [guardada, req.params.id]);
    if (existing.foto_url) deleteFile(existing.foto_url);
    res.json({ foto_url: guardada, message: 'Foto actualizada' });
  } catch (err) {
    if (guardada) deleteFile(guardada);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error al subir foto' });
  }
});

// Eliminar foto de un mensaje
router.delete('/mensajes/:id/foto', requireAdmin, async (req, res) => {
  try {
    const [[existing]] = await pool.execute('SELECT foto_url FROM plantilla_mensajes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Mensaje no encontrado' });
    await pool.execute('UPDATE plantilla_mensajes SET foto_url = NULL WHERE id = ?', [req.params.id]);
    if (existing.foto_url) deleteFile(existing.foto_url);
    res.json({ message: 'Foto eliminada' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar foto' }); }
});

router.delete('/mensajes/:id', requireAdmin, async (req, res) => {
  try {
    const [[existing]] = await pool.execute('SELECT foto_url FROM plantilla_mensajes WHERE id = ?', [req.params.id]);
    if (existing) deleteFile(existing.foto_url);
    const [r] = await pool.execute('DELETE FROM plantilla_mensajes WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Mensaje no encontrado' });
    res.json({ message: 'Mensaje eliminado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar mensaje' }); }
});

module.exports = router;
