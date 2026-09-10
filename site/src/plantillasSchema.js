const pool = require('./db');

async function ensurePlantillasSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plantilla_eventos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(200) NOT NULL,
      fecha DATE NOT NULL,
      orden INT NOT NULL DEFAULT 0,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_pe_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS plantilla_mensajes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      evento_id INT NOT NULL,
      titulo VARCHAR(200) NOT NULL,
      cuerpo TEXT NOT NULL,
      orden INT NOT NULL DEFAULT 0,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_pm_evento (evento_id),
      CONSTRAINT fk_pm_evento FOREIGN KEY (evento_id) REFERENCES plantilla_eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = { ensurePlantillasSchema };
