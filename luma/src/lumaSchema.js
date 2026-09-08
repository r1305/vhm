const pool = require('./db');

let ready = null;

// Vistas/accesos disponibles en el sistema
const ACCESOS_SISTEMA = [
  { clave: 'dashboard',       nombre: 'Dashboard',       descripcion: 'Vista principal con estadísticas' },
  { clave: 'eventos',         nombre: 'Eventos',         descripcion: 'Gestión de eventos' },
  { clave: 'registros',       nombre: 'Registros',       descripcion: 'Registros de asistentes' },
  { clave: 'administradores', nombre: 'Administradores', descripcion: 'Gestión de administradores' },
  { clave: 'roles',           nombre: 'Roles',           descripcion: 'Gestión de roles' },
  { clave: 'accesos',         nombre: 'Accesos',         descripcion: 'Asignación de accesos a roles' },
];

async function crearEsquema() {
  // ── Eventos ──────────────────────────────────────────────────────────────
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

  // migraciones seguras eventos
  await pool.query('ALTER TABLE luma_eventos ADD COLUMN descripcion TEXT NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_eventos ADD COLUMN capacidad INT NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_eventos ADD COLUMN imagen_url VARCHAR(500) NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_registros ADD COLUMN notas TEXT NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_registros ADD COLUMN asistio TINYINT(1) NOT NULL DEFAULT 0').catch(() => {});
  await pool.query('ALTER TABLE luma_registros ADD COLUMN fecha_asistencia TIMESTAMP NULL').catch(() => {});

  // ── Roles ─────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_roles (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      nombre         VARCHAR(80) NOT NULL UNIQUE,
      descripcion    VARCHAR(255) NULL,
      protegido      TINYINT(1) NOT NULL DEFAULT 0,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Seed rol SUPERADMIN protegido
  await pool.query(`
    INSERT IGNORE INTO luma_roles (id, nombre, descripcion, protegido)
    VALUES (1, 'SUPERADMIN', 'Rol con acceso total al sistema. No puede ser modificado.', 1)
  `);

  // ── Admins ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_admins (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      nombre         VARCHAR(120) NOT NULL,
      usuario        VARCHAR(80) NOT NULL UNIQUE,
      email          VARCHAR(150) NULL,
      password_hash  VARCHAR(255) NOT NULL,
      rol_id         INT NOT NULL DEFAULT 1,
      protegido      TINYINT(1) NOT NULL DEFAULT 0,
      activo         TINYINT(1) NOT NULL DEFAULT 1,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_la_rol (rol_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: agregar columnas nuevas si no existen
  await pool.query('ALTER TABLE luma_admins ADD COLUMN rol_id INT NOT NULL DEFAULT 1').catch(() => {});
  await pool.query('ALTER TABLE luma_admins ADD COLUMN protegido TINYINT(1) NOT NULL DEFAULT 0').catch(() => {});
  await pool.query('ALTER TABLE luma_admins ADD COLUMN usuario VARCHAR(80) NULL').catch(() => {});
  await pool.query('ALTER TABLE luma_admins ADD UNIQUE KEY uq_la_usuario (usuario)').catch(() => {});
  await pool.query('ALTER TABLE luma_admins DROP COLUMN rol').catch(() => {});

  // Seed SUPERADMIN protegido (usuario: luma@luma.com, contraseña: $LUMA$2026$)
  const bcrypt = require('bcryptjs');
  const [existing] = await pool.query('SELECT id FROM luma_admins WHERE protegido = 1 LIMIT 1');
  if (!existing.length) {
    const hash = await bcrypt.hash('$LUMA$2026$', 12);
    await pool.query(`
      INSERT INTO luma_admins (nombre, usuario, email, password_hash, rol_id, protegido, activo)
      VALUES ('Luma', 'Luma', 'luma@luma.com', ?, 1, 1, 1)
    `, [hash]);
  } else {
    // migrar usuario existente si la columna era null
    await pool.query("UPDATE luma_admins SET usuario = 'Luma' WHERE protegido = 1 AND (usuario IS NULL OR usuario = '')").catch(() => {});
  }

  // ── Accesos (catálogo de vistas) ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_accesos (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      clave       VARCHAR(80) NOT NULL UNIQUE,
      nombre      VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Seed accesos del sistema
  for (const a of ACCESOS_SISTEMA) {
    await pool.query(
      'INSERT IGNORE INTO luma_accesos (clave, nombre, descripcion) VALUES (?, ?, ?)',
      [a.clave, a.nombre, a.descripcion]
    );
  }

  // ── Rol-Accesos (pivot) ───────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS luma_rol_accesos (
      rol_id    INT NOT NULL,
      acceso_id INT NOT NULL,
      PRIMARY KEY (rol_id, acceso_id),
      FOREIGN KEY (rol_id)    REFERENCES luma_roles(id)   ON DELETE CASCADE,
      FOREIGN KEY (acceso_id) REFERENCES luma_accesos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // SUPERADMIN tiene todos los accesos por defecto
  const [accesos] = await pool.query('SELECT id FROM luma_accesos');
  for (const a of accesos) {
    await pool.query(
      'INSERT IGNORE INTO luma_rol_accesos (rol_id, acceso_id) VALUES (1, ?)', [a.id]
    );
  }
}

function ensureLumaSchema() {
  if (!ready) {
    ready = crearEsquema().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

module.exports = { ensureLumaSchema, ACCESOS_SISTEMA };
