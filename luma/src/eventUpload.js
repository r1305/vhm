const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOADS_DIR = path.join(__dirname, '../public/uploads/eventos');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname).toLowerCase() || '.jpg').replace(/[^a-z.]/g, '');
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `evento-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  },
});

const uploadEventoImagen = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'));
  },
});

function buildPublicUploadUrl(basePath, filename) {
  const base = (basePath || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
  return `${base}/uploads/eventos/${filename}`;
}

module.exports = { uploadEventoImagen, UPLOADS_DIR, buildPublicUploadUrl };
