const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

/**
 * Validación de imágenes por contenido, no por lo que declara el cliente.
 *
 * Por qué: `file.mimetype` y `originalname` los envía el atacante. Confiar en
 * ellos permitía subir un `.html` o un `.svg` con `Content-Type: image/png`;
 * como los archivos viven bajo `public/uploads/`, `express.static` los servía
 * como `text/html` y el navegador ejecutaba el script en el propio dominio
 * (robo de los tokens que el sitio guarda en localStorage).
 *
 * La regla aquí es: se mira la firma binaria del archivo y la extensión la
 * decide el servidor a partir de lo detectado. `originalname` no interviene.
 */

const UPLOADS_ROOT = path.join(__dirname, '../../public/uploads');

// Firma binaria -> extension que usaremos al guardar.
const TIPOS_IMAGEN = [
  {
    ext: '.jpg',
    mime: 'image/jpeg',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: '.png',
    mime: 'image/png',
    test: (b) => b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: '.gif',
    mime: 'image/gif',
    test: (b) => b.length >= 6 &&
      b.toString('latin1', 0, 4) === 'GIF8',
  },
  {
    ext: '.webp',
    mime: 'image/webp',
    test: (b) => b.length >= 12 &&
      b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
];

const ERROR_NO_IMAGEN = 'Solo se permiten imágenes (jpg, png, webp, gif)';

/**
 * Devuelve { ext, mime } si el buffer es realmente una imagen admitida,
 * o null si no lo es. No lanza.
 */
function detectarImagen(buffer) {
  if (!buffer || !buffer.length) return null;
  for (const tipo of TIPOS_IMAGEN) {
    if (tipo.test(buffer)) return { ext: tipo.ext, mime: tipo.mime };
  }
  return null;
}

/**
 * Multer en memoria: el archivo se valida antes de tocar el disco. Con
 * diskStorage el archivo influxable ya estaría escrito cuando Multer avisa del
 * error, y queda el trabajo de borrarlo a mano en cada ruta.
 */
function crearUploadImagen({ limiteBytes = 5 * 1024 * 1024 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limiteBytes, files: 1 },
  });
}

function directorioUploads(destino) {
  return path.join(UPLOADS_ROOT, destino);
}

function urlUploads(destino, nombreArchivo, assetBase) {
  // destino puede ir vacio (archivos que viven justo en uploads/), y sin esto
  // la URL saldria con una doble barra.
  const carpeta = String(destino || '').replace(/^\/+|\/+$/g, '');
  const base = `${String(assetBase || '').replace(/\/$/, '')}/uploads`;
  return carpeta ? `${base}/${carpeta}/${nombreArchivo}` : `${base}/${nombreArchivo}`;
}

/**
 * Valida y persiste un archivo subido. Devuelve null si no hay archivo.
 * Lanza si el contenido no es una imagen admitida.
 */
async function guardarImagen(file, { destino, prefijo = 'archivo', assetBase }) {
  if (!file || !file.buffer) return null;
  const tipo = detectarImagen(file.buffer);
  if (!tipo) throw Object.assign(new Error(ERROR_NO_IMAGEN), { status: 400 });

  const nombre = `${prefijo}_${crypto.randomBytes(12).toString('hex')}${tipo.ext}`;
  const dir = directorioUploads(destino);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, nombre), file.buffer);
  return { nombre, ext: tipo.ext, mime: tipo.mime, url: urlUploads(destino, nombre, assetBase) };
}

/**
 * Borra un archivo a partir de la URL que se guardó en la base de datos.
 * Se queda solo con el nombre (path.basename) para que una URL manipulada
 * no pueda borrar archivos de fuera del directorio de subidas.
 */
function borrarImagen(fotoUrl, destino) {
  if (!fotoUrl) return;
  const dir = directorioUploads(destino);
  const nombre = path.basename(String(fotoUrl).split('?')[0].split('#')[0]);
  const destinoArchivo = path.join(dir, nombre);
  if (!destinoArchivo.startsWith(dir + path.sep)) return;
  try { fs.unlinkSync(destinoArchivo); } catch (_) { /* noop */ }
}

module.exports = {
  ERROR_NO_IMAGEN,
  UPLOADS_ROOT,
  detectarImagen,
  crearUploadImagen,
  directorioUploads,
  urlUploads,
  guardarImagen,
  borrarImagen,
};