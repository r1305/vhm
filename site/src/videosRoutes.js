const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureVideoSchema, LANDING_INTRO_DEFAULT, LANDING_PACTO_DEFAULT } = require('./ensureSchema');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

// Garantiza que las tablas existan antes de atender cualquier ruta.
// Evita errores 500 por carrera al iniciar (auto-migración diferida).
router.use(async (req, res, next) => {
  try {
    await ensureVideoSchema();
    next();
  } catch (err) {
    console.error('[vhm] Esquema de videos no disponible:', err.message);
    res.status(503).json({ error: 'El servicio se está inicializando, intenta de nuevo en unos segundos.' });
  }
});

// --- Subida de miniaturas con nombres aleatorios seguros ---
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `video_${crypto.randomBytes(16).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (jpg, png, webp, gif)'));
  }
});

// Extrae el ID de un video de YouTube desde distintos formatos de URL
function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

// Genera una miniatura automática a partir del enlace del video (solo YouTube)
function autoThumbnail(url) {
  const yt = youtubeId(url);
  if (yt) return `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;
  return null;
}

// Extrae el ID de un video de Loom (32 caracteres hex)
function loomId(url) {
  if (!url) return null;
  const m = String(url).match(/loom\.com\/(?:share|embed)\/([0-9a-f]{32})/i);
  return m ? m[1] : null;
}

// Formatea una duración en segundos a un texto legible (ej. "1h 4min", "41 min").
function formatDuration(totalSeconds) {
  const s = Math.round(Number(totalSeconds));
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m} min`;
  return `${sec}s`;
}

// Obtiene miniatura y duración de un video de Loom usando su API oEmbed.
// Si la petición falla, usa una miniatura predecible de la CDN de Loom.
// SECURITY-REVIEW: llamada HTTP saliente; la URL se restringe al endpoint
// oEmbed de loom.com con un id validado (32 hex), evitando SSRF.
async function fetchLoomMeta(url) {
  const id = loomId(url);
  if (!id) return null;
  try {
    const oembed = `https://www.loom.com/v1/oembed?url=${encodeURIComponent(`https://www.loom.com/share/${id}`)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(oembed, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`oembed ${res.status}`);
    const data = await res.json();
    return {
      thumbnail_url: data.thumbnail_url || null,
      duracion: data.duration != null ? formatDuration(data.duration) : null,
      titulo: data.title ? String(data.title).trim() : null,
    };
  } catch (_) {
    // Sin conexión a Loom: dejamos que se use el placeholder y los datos manuales.
    return { thumbnail_url: null, duracion: null, titulo: null };
  }
}

// Completa miniatura, duración y título faltantes a partir del enlace
// (YouTube genera miniatura; Loom aporta miniatura, duración y título).
async function enriquecerMedia(videoUrl, { thumb, duracion, titulo } = {}) {
  let t = thumb || null;
  let d = duracion || null;
  let tit = titulo || null;
  if (!t) t = autoThumbnail(videoUrl);
  if (!t || !d || !tit) {
    const loom = await fetchLoomMeta(videoUrl);
    if (loom) {
      if (!t) t = loom.thumbnail_url;
      if (!d) d = loom.duracion;
      if (!tit) tit = loom.titulo;
    }
  }
  return { thumb: t, duracion: d, titulo: tit };
}

function eliminarArchivoLocal(thumbUrl) {
  // Solo borra archivos subidos localmente, no URLs externas
  const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const prefix = BASE ? `${BASE}/uploads/` : '/uploads/';
  if (thumbUrl && thumbUrl.includes('/uploads/')) {
    // Extrae solo la parte /uploads/archivo.ext para buscar en el filesystem
    const match = thumbUrl.match(/\/uploads\/[^?#]+/);
    if (match) {
      const filePath = path.join(__dirname, '../public', match[0]);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
      }
    }
  }
}

/* =========================================================
   RUTAS PÚBLICAS
   ========================================================= */

// Listar categorías activas con la cantidad de videos
// Configuración del landing (textos del hero de Camino Interior)
router.get('/landing', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT intro, pacto FROM video_landing WHERE id = 1');
    const cfg = rows[0] || {};
    res.json({
      intro: cfg.intro != null ? cfg.intro : LANDING_INTRO_DEFAULT,
      pacto: cfg.pacto != null ? cfg.pacto : LANDING_PACTO_DEFAULT
    });
  } catch (err) {
    console.error(err);
    res.json({ intro: LANDING_INTRO_DEFAULT, pacto: LANDING_PACTO_DEFAULT });
  }
});

// Actualizar textos del landing (admin)
router.put('/landing', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const intro = String((req.body && req.body.intro) || '').trim();
    const pacto = String((req.body && req.body.pacto) || '').trim();
    if (!intro || !pacto) {
      return res.status(400).json({ error: 'Ambos textos son obligatorios' });
    }
    await pool.query(
      `INSERT INTO video_landing (id, intro, pacto) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE intro = VALUES(intro), pacto = VALUES(pacto)`,
      [intro, pacto]
    );
    res.json({ message: 'Landing actualizado', intro, pacto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el landing' });
  }
});

router.get('/categorias', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.nombre, c.descripcion, c.orden,
              (SELECT COUNT(*) FROM videos v WHERE v.categoria_id = c.id AND v.activo = 1) AS total_videos
         FROM video_categorias c
        WHERE c.activo = 1
        ORDER BY c.orden ASC, c.nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// Listar videos activos (con nombre de categoría)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT v.id, v.categoria_id, v.titulo, v.subtitulo, v.descripcion,
              v.video_url, v.thumbnail_url, v.duracion, v.vistas, v.likes, v.orden,
              c.nombre AS categoria_nombre
         FROM videos v
         LEFT JOIN video_categorias c ON c.id = v.categoria_id
        WHERE v.activo = 1
        ORDER BY v.orden ASC, v.fecha_creacion DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener videos' });
  }
});

// Registrar una reproducción (interacción)
router.post('/:id/vista', async (req, res) => {
  try {
    await pool.execute('UPDATE videos SET vistas = vistas + 1 WHERE id = ? AND activo = 1', [req.params.id]);
    const [rows] = await pool.execute('SELECT vistas FROM videos WHERE id = ?', [req.params.id]);
    res.json({ vistas: rows[0] ? rows[0].vistas : 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar la vista' });
  }
});

// Dar / quitar "me gusta" (interacción)
router.post('/:id/like', async (req, res) => {
  try {
    const quitar = req.body && (req.body.quitar === true || req.body.quitar === 'true');
    if (quitar) {
      await pool.execute('UPDATE videos SET likes = GREATEST(likes - 1, 0) WHERE id = ? AND activo = 1', [req.params.id]);
    } else {
      await pool.execute('UPDATE videos SET likes = likes + 1 WHERE id = ? AND activo = 1', [req.params.id]);
    }
    const [rows] = await pool.execute('SELECT likes FROM videos WHERE id = ?', [req.params.id]);
    res.json({ likes: rows[0] ? rows[0].likes : 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar el me gusta' });
  }
});

/* =========================================================
   RUTAS ADMIN (Super Admin)
   ========================================================= */

// --- Categorías (admin) ---
router.get('/categorias/admin', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.*, u.nombre AS creado_por_nombre,
              (SELECT COUNT(*) FROM videos v WHERE v.categoria_id = c.id) AS total_videos
         FROM video_categorias c
         LEFT JOIN usuarios u ON c.creado_por = u.id
         ORDER BY c.orden ASC, c.nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

router.post('/categorias', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, orden, activo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const [result] = await pool.execute(
      'INSERT INTO video_categorias (nombre, descripcion, orden, activo, creado_por) VALUES (?, ?, ?, ?, ?)',
      [nombre, descripcion || null, parseInt(orden) || 1, activo === false || activo === 'false' || activo === '0' ? 0 : 1, req.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'Categoría creada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

router.put('/categorias/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, orden, activo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const [result] = await pool.execute(
      'UPDATE video_categorias SET nombre = ?, descripcion = ?, orden = ?, activo = ? WHERE id = ?',
      [nombre, descripcion || null, parseInt(orden) || 1, activo === false || activo === 'false' || activo === '0' ? 0 : 1, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

router.delete('/categorias/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    // Los videos asociados quedan sin categoría (ON DELETE SET NULL)
    const [result] = await pool.execute('DELETE FROM video_categorias WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

// --- Videos (admin) ---
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const categoriaId = req.query.categoria_id || '';
    const SORT_COLUMNS = { titulo: 'v.titulo', categoria_nombre: 'c.nombre', duracion: 'v.duracion', vistas: 'v.vistas', likes: 'v.likes' };
    const sortCol = SORT_COLUMNS[req.query.sort] || 'v.titulo';
    const orderDir = req.query.order === 'desc' ? 'DESC' : 'ASC';

    let where = '1=1';
    const params = [];
    if (search) { where += ' AND v.titulo LIKE ?'; params.push(`%${search}%`); }
    if (categoriaId) { where += ' AND v.categoria_id = ?'; params.push(categoriaId); }

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM videos v LEFT JOIN video_categorias c ON c.id = v.categoria_id WHERE ${where}`, params);
    const total = countRows[0].total;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const [rows] = await pool.query(
      `SELECT v.*, c.nombre AS categoria_nombre, u.nombre AS creado_por_nombre
       FROM videos v
       LEFT JOIN video_categorias c ON c.id = v.categoria_id
       LEFT JOIN usuarios u ON v.creado_por = u.id
       WHERE ${where} ORDER BY ${sortCol} ${orderDir} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data: rows, page, totalPages, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener videos' });
  }
});

router.post('/', authMiddleware, requireAdmin, upload.single('thumbnail'), async (req, res) => {
  try {
    const { categoria_id, titulo, subtitulo, descripcion, video_url, duracion, activo, thumbnail_url } = req.body;
    if (!video_url) return res.status(400).json({ error: 'El enlace del video es obligatorio' });

    // Prioridad: archivo subido > URL manual > miniatura/duración/título
    // automáticos del enlace (YouTube o Loom).
    const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
    const thumbInicial = req.file ? `${BASE}/uploads/${req.file.filename}` : (thumbnail_url || null);
    const media = await enriquecerMedia(video_url, {
      thumb: thumbInicial,
      duracion: duracion || null,
      titulo: (titulo || '').trim() || null,
    });
    if (!media.titulo) return res.status(400).json({ error: 'El título es obligatorio' });

    // El orden se asigna solo: siguiente número dentro de la categoría
    // (los videos sin categoría se agrupan juntos con <=> NULL-safe).
    const catId = categoria_id ? parseInt(categoria_id) : null;
    const [ordRows] = await pool.query(
      'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM videos WHERE categoria_id <=> ?',
      [catId]
    );
    const ordenFinal = ordRows[0] ? ordRows[0].siguiente : 1;

    const [result] = await pool.execute(
      `INSERT INTO videos (categoria_id, titulo, subtitulo, descripcion, video_url, thumbnail_url, duracion, orden, activo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        catId,
        media.titulo,
        subtitulo || null,
        descripcion || null,
        video_url,
        media.thumb,
        media.duracion || null,
        ordenFinal,
        activo === 'false' || activo === '0' || activo === false ? 0 : 1,
        req.user.id
      ]
    );
    res.status(201).json({ id: result.insertId, message: 'Video creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear video' });
  }
});

router.put('/:id', authMiddleware, requireAdmin, upload.single('thumbnail'), async (req, res) => {
  try {
    const { categoria_id, titulo, subtitulo, descripcion, video_url, duracion, activo, thumbnail_url, eliminar_thumbnail } = req.body;
    if (!video_url) return res.status(400).json({ error: 'El enlace del video es obligatorio' });

    const [existing] = await pool.execute('SELECT thumbnail_url, categoria_id, orden FROM videos WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

    let thumb = existing[0].thumbnail_url;

    if (req.file) {
      eliminarArchivoLocal(thumb);
      const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
      thumb = `${BASE}/uploads/${req.file.filename}`;
    } else if (eliminar_thumbnail === 'true' || eliminar_thumbnail === '1') {
      eliminarArchivoLocal(thumb);
      thumb = autoThumbnail(video_url);
    } else if (thumbnail_url !== undefined && thumbnail_url !== '' && thumbnail_url !== thumb) {
      eliminarArchivoLocal(thumb);
      thumb = thumbnail_url;
    }

    // Completa miniatura, duración y/o título faltantes desde el enlace (YouTube/Loom).
    const media = await enriquecerMedia(video_url, {
      thumb,
      duracion: duracion || null,
      titulo: (titulo || '').trim() || null,
    });
    if (!media.titulo) return res.status(400).json({ error: 'El título es obligatorio' });

    // El orden se mantiene; solo se recalcula si el video cambia de categoría.
    const catId = categoria_id ? parseInt(categoria_id) : null;
    const catAnterior = existing[0].categoria_id;
    let ordenFinal = existing[0].orden || 1;
    if (catId !== catAnterior) {
      const [ordRows] = await pool.query(
        'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM videos WHERE categoria_id <=> ?',
        [catId]
      );
      ordenFinal = ordRows[0] ? ordRows[0].siguiente : 1;
    }

    const [result] = await pool.execute(
      `UPDATE videos SET categoria_id = ?, titulo = ?, subtitulo = ?, descripcion = ?,
              video_url = ?, thumbnail_url = ?, duracion = ?, orden = ?, activo = ?
       WHERE id = ?`,
      [
        catId,
        media.titulo,
        subtitulo || null,
        descripcion || null,
        video_url,
        media.thumb,
        media.duracion || null,
        ordenFinal,
        activo === 'false' || activo === '0' || activo === false ? 0 : 1,
        req.params.id
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Video no encontrado' });
    res.json({ message: 'Video actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar video' });
  }
});

router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [existing] = await pool.execute('SELECT thumbnail_url FROM videos WHERE id = ?', [req.params.id]);
    if (existing.length > 0) eliminarArchivoLocal(existing[0].thumbnail_url);
    const [result] = await pool.execute('DELETE FROM videos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Video no encontrado' });
    res.json({ message: 'Video eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar video' });
  }
});

module.exports = router;
