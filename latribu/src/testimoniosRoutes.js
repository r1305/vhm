const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { crearUploadImagen, guardarImagen, borrarImagen } = require('./lib/subidaImagen');

const router = Router();

// Las fotos viven en public/uploads/ sin subcarpeta, como antes.
const DESTINO = '';
const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');

const upload = crearUploadImagen({ limiteBytes: 5 * 1024 * 1024 });

// Multer avisa del error (tamaño excedido, varios archivos) por callback. Sin
// esto Express lo escalaría al manejador genérico y el admin vería un 500.
const uploadFoto = (req, res, next) =>
  upload.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Archivo no válido' });
    next();
  });

// ADMIN y SUPER_ADMIN tienen los mismos permisos de escritura
function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

async function ensureTestimoniosConfig() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonios_config (
      id INT PRIMARY KEY DEFAULT 1,
      seccion_activa BOOLEAN DEFAULT TRUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [rows] = await pool.query('SELECT id FROM testimonios_config WHERE id = 1');
  if (rows.length === 0) await pool.query('INSERT INTO testimonios_config (id, seccion_activa) VALUES (1, TRUE)');
}
ensureTestimoniosConfig().catch(() => {});

// Ruta pública
router.get('/', async (req, res) => {
  try {
    const [cfg] = await pool.query('SELECT seccion_activa FROM testimonios_config WHERE id = 1');
    if (cfg.length && !cfg[0].seccion_activa) return res.json({ seccion_activa: false, data: [] });
    const [rows] = await pool.execute('SELECT id, autor, texto, foto_url FROM testimonios WHERE activo = 1 ORDER BY id ASC');
    res.json({ seccion_activa: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Config visibilidad sección
router.get('/config', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT seccion_activa FROM testimonios_config WHERE id = 1');
    res.json({ seccion_activa: rows.length ? !!rows[0].seccion_activa : true });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener config' });
  }
});

router.put('/config', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const activa = req.body.seccion_activa === true || req.body.seccion_activa === 'true' || req.body.seccion_activa === 1;
    await pool.query('UPDATE testimonios_config SET seccion_activa = ? WHERE id = 1', [activa ? 1 : 0]);
    res.json({ message: activa ? 'Sección habilitada' : 'Sección deshabilitada', seccion_activa: activa });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar config' });
  }
});

// Listar todos (admin)
router.get('/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.*, u.nombre AS creado_por_nombre
       FROM testimonios t
       LEFT JOIN tribu_admins u ON t.creado_por = u.id
       ORDER BY t.id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Crear
router.post('/', authMiddleware, requireAdmin, uploadFoto, async (req, res) => {
  let guardada = null;
  try {
    const { autor, texto, activo } = req.body;
    const foto_url = req.file ? (guardada = await guardarImagen(req.file, {
      destino: DESTINO, prefijo: 'testimonio', assetBase: BASE
    })).url : null;

    if (!autor && !texto && !foto_url) {
      if (guardada) borrarImagen(guardada.url, DESTINO);
      return res.status(400).json({ error: 'Debe proporcionar al menos un campo (autor, texto o foto)' });
    }

    const [result] = await pool.execute(
      'INSERT INTO testimonios (autor, texto, foto_url, activo, creado_por) VALUES (?, ?, ?, ?, ?)',
      [autor || null, texto || null, foto_url, activo === 'true' || activo === '1' ? 1 : 0, req.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'Testimonio creado' });
  } catch (err) {
    if (guardada) borrarImagen(guardada.url, DESTINO);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error al crear testimonio' });
  }
});

// Actualizar
router.put('/:id', authMiddleware, requireAdmin, uploadFoto, async (req, res) => {
  let guardada = null;
  try {
    const { autor, texto, activo, eliminar_foto } = req.body;
    const [existing] = await pool.execute('SELECT foto_url FROM testimonios WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      // Con memoria el archivo no llegó al disco: no hay nada que deshacer.
      return res.status(404).json({ error: 'Testimonio no encontrado' });
    }

    let foto_url = existing[0].foto_url;
    // La anterior se borra solo cuando el UPDATE ya funciono: si falla, el
    // testimonio sigue apuntando a un archivo que sí existe.
    let anteriorABorrar = null;

    if (req.file) {
      guardada = await guardarImagen(req.file, { destino: DESTINO, prefijo: 'testimonio', assetBase: BASE });
      foto_url = guardada.url;
      if (existing[0].foto_url) anteriorABorrar = existing[0].foto_url;
    }

    if (eliminar_foto === 'true' || eliminar_foto === '1') {
      if (foto_url && !anteriorABorrar) anteriorABorrar = foto_url;
      foto_url = null;
    }

    const [result] = await pool.execute(
      'UPDATE testimonios SET autor = ?, texto = ?, foto_url = ?, activo = ? WHERE id = ?',
      [autor || null, texto || null, foto_url, activo === 'true' || activo === '1' ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      if (guardada) borrarImagen(guardada.url, DESTINO);
      return res.status(404).json({ error: 'Testimonio no encontrado' });
    }
    if (anteriorABorrar) borrarImagen(anteriorABorrar, DESTINO);
    res.json({ message: 'Testimonio actualizado' });
  } catch (err) {
    if (guardada) borrarImagen(guardada.url, DESTINO);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar testimonio' });
  }
});

// Eliminar
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [existing] = await pool.execute('SELECT foto_url FROM testimonios WHERE id = ?', [req.params.id]);
    const [result] = await pool.execute('DELETE FROM testimonios WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });
    // La foto se borra despues del DELETE: si el borrado falla, el testimonio
    // sigue existiendo y su imagen tambien.
    if (existing.length > 0 && existing[0].foto_url) borrarImagen(existing[0].foto_url, DESTINO);
    res.json({ message: 'Testimonio eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar testimonio' });
  }
});

module.exports = router;
