const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `testimonio_${crypto.randomBytes(16).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (jpg, png, webp, gif)'));
  }
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
    const [rows] = await pool.execute('SELECT * FROM testimonios ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Crear
router.post('/', authMiddleware, requireAdmin, upload.single('foto'), async (req, res) => {
  try {
    const { autor, texto, activo } = req.body;
    const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
    const foto_url = req.file ? `${BASE}/uploads/${req.file.filename}` : null;

    if (!autor && !texto && !foto_url)
      return res.status(400).json({ error: 'Debe proporcionar al menos un campo (autor, texto o foto)' });

    const [result] = await pool.execute(
      'INSERT INTO testimonios (autor, texto, foto_url, activo) VALUES (?, ?, ?, ?)',
      [autor || null, texto || null, foto_url, activo === 'true' || activo === '1' ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, message: 'Testimonio creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear testimonio' });
  }
});

// Actualizar
router.put('/:id', authMiddleware, requireAdmin, upload.single('foto'), async (req, res) => {
  try {
    const { autor, texto, activo, eliminar_foto } = req.body;
    const [existing] = await pool.execute('SELECT foto_url FROM testimonios WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });

    let foto_url = existing[0].foto_url;

    if (req.file) {
      if (foto_url) {
        const match = foto_url.match(/\/uploads\/[^?#]+/);
        if (match) {
          const oldPath = path.join(__dirname, '../public', match[0]);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }
      const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
      foto_url = `${BASE}/uploads/${req.file.filename}`;
    }

    if (eliminar_foto === 'true' || eliminar_foto === '1') {
      if (foto_url) {
        const match = foto_url.match(/\/uploads\/[^?#]+/);
        if (match) {
          const oldPath = path.join(__dirname, '../public', match[0]);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }
      foto_url = null;
    }

    const [result] = await pool.execute(
      'UPDATE testimonios SET autor = ?, texto = ?, foto_url = ?, activo = ? WHERE id = ?',
      [autor || null, texto || null, foto_url, activo === 'true' || activo === '1' ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });
    res.json({ message: 'Testimonio actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar testimonio' });
  }
});

// Eliminar
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [existing] = await pool.execute('SELECT foto_url FROM testimonios WHERE id = ?', [req.params.id]);
    if (existing.length > 0 && existing[0].foto_url) {
      const match = existing[0].foto_url.match(/\/uploads\/[^?#]+/);
      if (match) {
        const filePath = path.join(__dirname, '../public', match[0]);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    const [result] = await pool.execute('DELETE FROM testimonios WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });
    res.json({ message: 'Testimonio eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar testimonio' });
  }
});

module.exports = router;
