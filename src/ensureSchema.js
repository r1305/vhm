const pool = require('./db');

// Textos por defecto del hero de "Camino Interior" (los que ya estaban en el HTML).
const LANDING_INTRO_DEFAULT = 'Cada masterclass que encontrarás aquí nació de historias reales. No estás entrando a ver "contenido": estás entrando a un espacio pensado para devolverte claridad, fuerza y dirección cuando más lo necesitas.';
const LANDING_PACTO_DEFAULT = 'Cada recurso tiene un propósito: ayudarte a entender, soltar, ordenar, sanar y avanzar. Lo importante no es la velocidad, sino tu constancia.';

let readyPromise = null;

// Crea las tablas del módulo de videos si no existen (auto-migración).
// Memoiza la promesa: se ejecuta una sola vez y todas las rutas pueden
// esperarla. Si falla, limpia la caché para reintentar en la próxima llamada.
function ensureVideoSchema() {
  if (!readyPromise) {
    readyPromise = crearEsquema().catch((err) => {
      readyPromise = null; // permite reintentar en la siguiente petición
      throw err;
    });
  }
  return readyPromise;
}

async function crearEsquema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_categorias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NULL,
      orden INT DEFAULT 1,
      activo BOOLEAN DEFAULT TRUE,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      categoria_id INT NULL,
      titulo VARCHAR(200) NOT NULL,
      subtitulo VARCHAR(255) NULL,
      descripcion TEXT NULL,
      video_url VARCHAR(500) NOT NULL,
      thumbnail_url VARCHAR(500) NULL,
      duracion VARCHAR(40) NULL,
      vistas INT DEFAULT 0,
      likes INT DEFAULT 0,
      orden INT DEFAULT 1,
      activo BOOLEAN DEFAULT TRUE,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_videos_categoria (categoria_id),
      KEY idx_videos_activo (activo),
      CONSTRAINT fk_video_categoria FOREIGN KEY (categoria_id)
        REFERENCES video_categorias(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Categorías de ejemplo solo en la primera instalación (tabla vacía).
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM video_categorias');
  if (rows[0].total === 0) {
    await pool.query(
      `INSERT INTO video_categorias (nombre, descripcion, orden, activo) VALUES
        ('Sanación Emocional', 'Herramientas para entender, soltar y sanar lo que hoy te pesa.', 1, TRUE),
        ('Neurociencias & Regulación', 'Estrategias desde la neurociencia para regular tu sistema nervioso.', 2, TRUE),
        ('Narcisismo', 'Cómo identificar y protegerte de relaciones dañinas.', 3, TRUE)`
    );
  }

  await renumerarOrdenSiHaceFalta();

  // Configuración del landing de "Camino Interior" (fila única id = 1).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_landing (
      id INT PRIMARY KEY,
      intro TEXT NULL,
      pacto TEXT NULL,
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [landing] = await pool.query('SELECT id FROM video_landing WHERE id = 1');
  if (landing.length === 0) {
    await pool.query(
      'INSERT INTO video_landing (id, intro, pacto) VALUES (1, ?, ?)',
      [LANDING_INTRO_DEFAULT, LANDING_PACTO_DEFAULT]
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_eventos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(200) NOT NULL,
      fecha DATE NOT NULL,
      hora_inicio TIME NOT NULL,
      hora_fin TIME NULL,
      lugar VARCHAR(255) NOT NULL,
      ubicacion VARCHAR(500) NULL,
      activo BOOLEAN DEFAULT TRUE,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_eventos_fecha (fecha),
      KEY idx_eventos_activo (activo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Permite link opcional en instalaciones previas.
  await pool.query('ALTER TABLE tribu_eventos MODIFY ubicacion VARCHAR(500) NULL').catch(() => {});
}

// Renumera el campo "orden" de los videos por categoría (según fecha de subida)
// solo si existen órdenes duplicados dentro de una misma categoría —es decir,
// el caso en que todos quedaron en 1—. Es idempotente: tras renumerar, los
// órdenes son únicos por categoría y no se vuelve a ejecutar.
async function renumerarOrdenSiHaceFalta() {
  const [dups] = await pool.query(
    `SELECT COUNT(*) AS grupos FROM (
       SELECT categoria_id, orden, COUNT(*) AS n
         FROM videos
        GROUP BY categoria_id, orden
       HAVING n > 1
     ) t`
  );
  if (!dups[0] || dups[0].grupos === 0) return;

  const [vids] = await pool.query(
    `SELECT id, categoria_id FROM videos
      ORDER BY (categoria_id IS NULL), categoria_id ASC, fecha_creacion ASC, id ASC`
  );
  const contadores = new Map();
  for (const v of vids) {
    const clave = v.categoria_id == null ? 'null' : String(v.categoria_id);
    const siguiente = (contadores.get(clave) || 0) + 1;
    contadores.set(clave, siguiente);
    await pool.query('UPDATE videos SET orden = ? WHERE id = ?', [siguiente, v.id]);
  }
}

module.exports = { ensureVideoSchema, LANDING_INTRO_DEFAULT, LANDING_PACTO_DEFAULT };
