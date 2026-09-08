const pool = require('./db');

let ready = null;

async function crearEsquema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_eventos (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      nombre         VARCHAR(200) NOT NULL,
      descripcion    TEXT NULL,
      fecha          DATE NOT NULL,
      hora_inicio    TIME NOT NULL,
      hora_fin       TIME NULL,
      lugar          VARCHAR(255) NOT NULL,
      link           VARCHAR(500) NULL,
      capacidad      INT NULL,
      imagen_url     VARCHAR(500) NULL,
      activo         TINYINT(1) NOT NULL DEFAULT 1,
      creado_por     INT NULL,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_le_fecha (fecha),
      KEY idx_le_activo (activo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_registros (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      evento_id      INT NOT NULL,
      nombre         VARCHAR(150) NOT NULL,
      email          VARCHAR(150) NOT NULL,
      telefono       VARCHAR(30) NULL,
      notas          TEXT NULL,
      estado         ENUM('pendiente','confirmado','cancelado') NOT NULL DEFAULT 'pendiente',
      fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_lr_evento (evento_id),
      KEY idx_lr_email (email),
      CONSTRAINT fk_lr_evento FOREIGN KEY (evento_id) REFERENCES luma_eventos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // migraciones seguras
  await pool.query('ALTER TABLE luma_eventos ADD COLUMN descripcion TEXT NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_eventos ADD COLUMN capacidad INT NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_eventos ADD COLUMN imagen_url VARCHAR(500) NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_registros ADD COLUMN notas TEXT NULL').catch(() => {});

  // tabla de admins propia
  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_admins (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      nombre         VARCHAR(120) NOT NULL,
      email          VARCHAR(150) NOT NULL UNIQUE,
      password_hash  VARCHAR(255) NOT NULL,
      rol            ENUM('ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'ADMIN',
      activo         TINYINT(1) NOT NULL DEFAULT 1,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function ensureLumaSchema() {
  if (!ready) {
    ready = crearEsquema().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

module.exports = { ensureLumaSchema };
