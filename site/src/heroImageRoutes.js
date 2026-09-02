const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authMiddleware } = require('./auth');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
const HERO_FILE = path.join(UPLOADS_DIR, 'hero-portada');

// Asegurar carpeta uploads
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'hero-portada' + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
  },
});

// Público — obtener URL de la imagen de portada
router.get('/', (req, res) => {
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    if (fs.existsSync(HERO_FILE + ext)) {
      const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
      return res.json({ url: `${base}/uploads/hero-portada${ext}?v=${Date.now()}` });
    }
  }
  res.json({ url: null });
});

// Admin — subir imagen
router.post('/', authMiddleware, requireAdmin, upload.single('imagen'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  // Eliminar versiones anteriores con otras extensiones
  ['.jpg', '.jpeg', '.png', '.webp'].forEach(ext => {
    const f = HERO_FILE + ext;
    if (f !== req.file.path && fs.existsSync(f)) fs.unlinkSync(f);
  });
  const base = (res.locals.basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  const ext = path.extname(req.file.filename);
  res.json({ ok: true, url: `${base}/uploads/hero-portada${ext}?v=${Date.now()}` });
});

// Admin — eliminar imagen
router.delete('/', authMiddleware, requireAdmin, (req, res) => {
  ['.jpg', '.jpeg', '.png', '.webp'].forEach(ext => {
    const f = HERO_FILE + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  res.json({ ok: true });
});

module.exports = router;
