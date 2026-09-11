const pool = require('./db');

async function ensureEncuestasSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS encuestas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      titulo VARCHAR(255) NOT NULL,
      descripcion TEXT NULL,
      slug VARCHAR(64) NOT NULL,
      activa TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_encuesta_slug (slug),
      KEY idx_encuesta_activa (activa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS encuesta_preguntas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      encuesta_id INT NOT NULL,
      texto VARCHAR(500) NOT NULL,
      tipo ENUM('single','multiple') NOT NULL DEFAULT 'single',
      orden INT NOT NULL DEFAULT 0,
      obligatoria TINYINT(1) NOT NULL DEFAULT 1,
      KEY idx_ep_encuesta (encuesta_id),
      CONSTRAINT fk_ep_encuesta FOREIGN KEY (encuesta_id) REFERENCES encuestas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS encuesta_opciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pregunta_id INT NOT NULL,
      texto VARCHAR(255) NOT NULL,
      orden INT NOT NULL DEFAULT 0,
      KEY idx_eo_pregunta (pregunta_id),
      CONSTRAINT fk_eo_pregunta FOREIGN KEY (pregunta_id) REFERENCES encuesta_preguntas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS encuesta_respuestas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      encuesta_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_er_encuesta (encuesta_id),
      CONSTRAINT fk_er_encuesta FOREIGN KEY (encuesta_id) REFERENCES encuestas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS encuesta_respuesta_detalle (
      id INT AUTO_INCREMENT PRIMARY KEY,
      respuesta_id INT NOT NULL,
      pregunta_id INT NOT NULL,
      opcion_id INT NOT NULL,
      KEY idx_erd_respuesta (respuesta_id),
      KEY idx_erd_pregunta (pregunta_id),
      KEY idx_erd_opcion (opcion_id),
      CONSTRAINT fk_erd_respuesta FOREIGN KEY (respuesta_id) REFERENCES encuesta_respuestas(id) ON DELETE CASCADE,
      CONSTRAINT fk_erd_pregunta FOREIGN KEY (pregunta_id) REFERENCES encuesta_preguntas(id) ON DELETE CASCADE,
      CONSTRAINT fk_erd_opcion FOREIGN KEY (opcion_id) REFERENCES encuesta_opciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = { ensureEncuestasSchema };
