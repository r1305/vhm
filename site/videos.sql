-- Módulo de Videos / Masterclass (Base Maestra de Recursos)
-- Ejecutar en la base de datos de VHM.

-- Categorías para agrupar los videos (ej. Sanación Emocional, Neurociencias, etc.)
CREATE TABLE IF NOT EXISTS video_categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  orden INT DEFAULT 1,
  activo BOOLEAN DEFAULT TRUE,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos / recursos. video_url admite YouTube, Vimeo o un enlace directo (mp4).
-- thumbnail_url puede ser una imagen subida o generada automáticamente desde el enlace.
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
  CONSTRAINT fk_video_categoria FOREIGN KEY (categoria_id)
    REFERENCES video_categorias(id) ON DELETE SET NULL
);

CREATE INDEX idx_videos_categoria ON videos (categoria_id);
CREATE INDEX idx_videos_activo ON videos (activo);

-- Categorías de ejemplo (basadas en la base maestra de recursos)
INSERT INTO video_categorias (nombre, descripcion, orden, activo) VALUES
  ('Sanación Emocional', 'Herramientas para entender, soltar y sanar lo que hoy te pesa.', 1, TRUE),
  ('Neurociencias & Regulación', 'Estrategias desde la neurociencia para regular tu sistema nervioso.', 2, TRUE),
  ('Narcisismo', 'Cómo identificar y protegerte de relaciones dañinas.', 3, TRUE);
