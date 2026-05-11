const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

// Configurar multer para subida de fotos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `testimonio_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|gif)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (jpg, png, webp, gif)'));
  }
});

// Ruta pública - obtener testimonios activos
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, autor, texto, foto_url FROM testimonios WHERE activo = 1 ORDER BY orden ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Ruta admin - obtener todos los testimonios
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const [rows] = await pool.execute('SELECT * FROM testimonios ORDER BY orden ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Crear testimonio
router.post('/', authMiddleware, upload.single('foto'), async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const { autor, texto, orden, activo } = req.body;
    const foto_url = req.file ? `/uploads/${req.file.filename}` : null;

    if (!autor && !texto && !foto_url) {
      return res.status(400).json({ error: 'Debe proporcionar al menos un campo (autor, texto o foto)' });
    }

    const [result] = await pool.execute(
      'INSERT INTO testimonios (autor, texto, foto_url, orden, activo) VALUES (?, ?, ?, ?, ?)',
      [autor || null, texto || null, foto_url, parseInt(orden) || 1, activo === 'true' || activo === '1' ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, message: 'Testimonio creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear testimonio' });
  }
});

// Actualizar testimonio
router.put('/:id', authMiddleware, upload.single('foto'), async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const { autor, texto, orden, activo, eliminar_foto } = req.body;

    // Obtener testimonio actual
    const [existing] = await pool.execute('SELECT foto_url FROM testimonios WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });

    let foto_url = existing[0].foto_url;

    // Si se sube nueva foto, eliminar la anterior
    if (req.file) {
      if (foto_url) {
        const oldPath = path.join(__dirname, '../public', foto_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      foto_url = `/uploads/${req.file.filename}`;
    }

    // Si se pide eliminar foto
    if (eliminar_foto === 'true' || eliminar_foto === '1') {
      if (foto_url) {
        const oldPath = path.join(__dirname, '../public', foto_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      foto_url = null;
    }

    const [result] = await pool.execute(
      'UPDATE testimonios SET autor = ?, texto = ?, foto_url = ?, orden = ?, activo = ? WHERE id = ?',
      [autor || null, texto || null, foto_url, parseInt(orden) || 1, activo === 'true' || activo === '1' ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });
    res.json({ message: 'Testimonio actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar testimonio' });
  }
});

// Eliminar testimonio
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });

    // Eliminar foto si existe
    const [existing] = await pool.execute('SELECT foto_url FROM testimonios WHERE id = ?', [req.params.id]);
    if (existing.length > 0 && existing[0].foto_url) {
      const filePath = path.join(__dirname, '../public', existing[0].foto_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
