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
  try {
    await pool.query('ALTER TABLE video_landing ADD COLUMN hero_video_url VARCHAR(500) NULL');
  } catch (_) { /* ya existe */ }

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

  // ── Agregar columna creado_por a tablas existentes (migración) ──
  const tablasConCreador = ['testimonios', 'videos', 'video_categorias', 'tribu_eventos'];
  for (const tabla of tablasConCreador) {
    await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN creado_por INT NULL`).catch(() => {});
  }
  // Columna respondido_por en reclamos (quién respondió)
  await pool.query('ALTER TABLE reclamos ADD COLUMN respondido_por INT NULL').catch(() => {});

  // Suscripciones
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suscripciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      precio DECIMAL(10,2) NOT NULL,
      descripcion VARCHAR(255) NULL,
      vigencia_dias INT NOT NULL DEFAULT 30,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query('ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS vigencia_dias INT NOT NULL DEFAULT 30').catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS config_suscripciones (
      id INT PRIMARY KEY,
      activo BOOLEAN DEFAULT FALSE,
      visible BOOLEAN DEFAULT FALSE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [cfgSus] = await pool.query('SELECT id FROM config_suscripciones WHERE id = 1');
  if (cfgSus.length === 0) {
    await pool.query('INSERT INTO config_suscripciones (id, activo, visible) VALUES (1, FALSE, FALSE)');
  }
  await pool.query('ALTER TABLE config_suscripciones ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT FALSE').catch(() => {});

  const [planRows] = await pool.query('SELECT COUNT(*) AS total FROM suscripciones');
  if (planRows[0].total === 0) {
    await pool.query(
      `INSERT INTO suscripciones (nombre, precio, descripcion) VALUES
        ('Plan Base', 39.90, 'Próximamente'),
        ('Plan VIP', 89.90, 'Próximamente')`
    );
  }

  // Usuarios de La Tribu (espejo de pacientes sin terapeuta_id)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_users (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      nombre           VARCHAR(120) NOT NULL,
      apellido         VARCHAR(120) NOT NULL,
      email            VARCHAR(150) DEFAULT NULL,
      telefono         VARCHAR(30)  DEFAULT NULL,
      fecha_nacimiento DATE         DEFAULT NULL,
      genero           ENUM('masculino','femenino','otro','prefiero_no_decir') DEFAULT NULL,
      direccion        VARCHAR(255) DEFAULT NULL,
      motivo_consulta  TEXT         DEFAULT NULL,
      fuente           VARCHAR(80)  DEFAULT NULL,
      fuente_detalle   VARCHAR(200) DEFAULT NULL,
      estado           ENUM('prospecto','activo','alta','inactivo','lista_espera') NOT NULL DEFAULT 'prospecto',
      consentimiento   TINYINT(1)   NOT NULL DEFAULT 0,
      consentimiento_at TIMESTAMP   NULL DEFAULT NULL,
      notas_internas   TEXT         DEFAULT NULL,
      password         TEXT         NOT NULL,
      psw_temp         TINYINT(1)   NOT NULL DEFAULT 1 CHECK (psw_temp IN (0,1)),
      is_suscribed     TINYINT(1)   NOT NULL DEFAULT 0,
      created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Culqi (pasarela de pagos La Tribu)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config_culqi (
      id             INT PRIMARY KEY,
      activo         TINYINT(1) NOT NULL DEFAULT 0,
      modo           ENUM('sandbox','produccion') NOT NULL DEFAULT 'sandbox',
      public_key     VARCHAR(120) NOT NULL DEFAULT '',
      secret_key     VARCHAR(120) NOT NULL DEFAULT '',
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [culqiRows] = await pool.query('SELECT id FROM config_culqi WHERE id = 1');
  if (culqiRows.length === 0) {
    await pool.query("INSERT INTO config_culqi (id, activo, modo, public_key, secret_key) VALUES (1, 0, 'sandbox', '', '')");
  }
  // Migración desde Mercado Pago si existía config previa
  await pool.query(`
    UPDATE config_culqi c
    JOIN config_mercadopago m ON m.id = 1
    SET c.activo = m.activo, c.modo = m.modo, c.public_key = m.public_key, c.secret_key = m.access_token
    WHERE c.id = 1 AND c.public_key = '' AND c.secret_key = '' AND m.public_key <> ''
  `).catch(() => {});

  // Mercado Pago (legado — ya no se usa en código)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config_mercadopago (
      id             INT PRIMARY KEY,
      activo         TINYINT(1) NOT NULL DEFAULT 0,
      modo           ENUM('sandbox','produccion') NOT NULL DEFAULT 'sandbox',
      public_key     VARCHAR(120) NOT NULL DEFAULT '',
      access_token   VARCHAR(120) NOT NULL DEFAULT '',
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [mpRows] = await pool.query('SELECT id FROM config_mercadopago WHERE id = 1');
  if (mpRows.length === 0) {
    await pool.query("INSERT INTO config_mercadopago (id, activo, modo, public_key, access_token) VALUES (1, 0, 'sandbox', '', '')");
  }

  // Suscripciones activas de usuarios de La Tribu
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_suscripciones (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      tribu_user_id   INT NOT NULL,
      suscripcion_id  INT NOT NULL,
      fecha_inicio    DATE NOT NULL,
      fecha_fin       DATE NOT NULL,
      activo          TINYINT(1) NOT NULL DEFAULT 1,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ts_user (tribu_user_id),
      KEY idx_ts_fin (fecha_fin),
      FOREIGN KEY (tribu_user_id) REFERENCES tribu_users(id) ON DELETE CASCADE,
      FOREIGN KEY (suscripcion_id) REFERENCES suscripciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN mp_payment_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD KEY idx_ts_mp (mp_payment_id)').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN mp_preapproval_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD KEY idx_ts_preapproval (mp_preapproval_id)').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN auto_renovacion TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN cancelada_at TIMESTAMP NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN mp_order_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD KEY idx_ts_order (mp_order_id)').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN mp_customer_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN mp_card_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN mp_card_brand VARCHAR(32) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN next_renovacion_intento DATETIME NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN renovacion_intentos INT NOT NULL DEFAULT 0').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN culqi_charge_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD KEY idx_ts_culqi_charge (culqi_charge_id)').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN culqi_customer_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN culqi_card_id VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_suscripciones ADD COLUMN culqi_card_brand VARCHAR(32) NULL').catch(() => {});
  await pool.query(`
    UPDATE tribu_suscripciones
    SET culqi_charge_id = COALESCE(culqi_charge_id, mp_order_id, mp_payment_id),
        culqi_customer_id = COALESCE(culqi_customer_id, mp_customer_id),
        culqi_card_id = COALESCE(culqi_card_id, mp_card_id),
        culqi_card_brand = COALESCE(culqi_card_brand, mp_card_brand)
    WHERE culqi_charge_id IS NULL OR culqi_customer_id IS NULL OR culqi_card_id IS NULL
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_payer_profiles (
      tribu_user_id INT NOT NULL PRIMARY KEY,
      identification_type VARCHAR(10) NULL,
      identification_number VARCHAR(20) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (tribu_user_id) REFERENCES tribu_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query('ALTER TABLE tribu_payer_profiles ADD COLUMN billing_email VARCHAR(150) NULL').catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_saved_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tribu_user_id INT NOT NULL,
      culqi_customer_id VARCHAR(64) NOT NULL,
      culqi_card_id VARCHAR(64) NOT NULL,
      culqi_card_brand VARCHAR(32) NULL,
      last_four_digits VARCHAR(4) NULL,
      exp_month INT NULL,
      exp_year INT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_culqi_card (tribu_user_id, culqi_card_id),
      KEY idx_tsc_user (tribu_user_id),
      FOREIGN KEY (tribu_user_id) REFERENCES tribu_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_culqi_payment_events (
      culqi_charge_id VARCHAR(64) NOT NULL PRIMARY KEY,
      tribu_suscripcion_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tcpe_sub (tribu_suscripcion_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_culqi_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      culqi_charge_id VARCHAR(64) NOT NULL,
      tribu_user_id INT NULL,
      suscripcion_plan_id INT NULL,
      tribu_suscripcion_id INT NULL,
      amount_cents INT NULL,
      currency_code VARCHAR(3) DEFAULT 'PEN',
      status VARCHAR(20) NOT NULL,
      outcome_type VARCHAR(40) NULL,
      outcome_code VARCHAR(20) NULL,
      merchant_message VARCHAR(255) NULL,
      user_message VARCHAR(255) NULL,
      external_reference VARCHAR(64) NULL,
      event_source VARCHAR(30) NOT NULL DEFAULT 'api',
      card_brand VARCHAR(20) NULL,
      card_last_four VARCHAR(4) NULL,
      payer_email_masked VARCHAR(150) NULL,
      culqi_created_at DATETIME NULL,
      payload_json JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tct_charge (culqi_charge_id),
      KEY idx_tct_user (tribu_user_id),
      KEY idx_tct_status (status),
      KEY idx_tct_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    INSERT IGNORE INTO tribu_culqi_payment_events (culqi_charge_id, tribu_suscripcion_id, created_at)
    SELECT mp_payment_id, tribu_suscripcion_id, created_at FROM tribu_mp_payment_events
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_mp_payment_events (
      mp_payment_id VARCHAR(64) NOT NULL PRIMARY KEY,
      tribu_suscripcion_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tmpe_sub (tribu_suscripcion_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Columna para contraseña temporal en texto plano (se borra al cambiar)
  await pool.query('ALTER TABLE tribu_users ADD COLUMN password_plain VARCHAR(20) NULL').catch(() => {});

  // Columnas reset_token para tribu_users
  await pool.query('ALTER TABLE tribu_users ADD COLUMN reset_token VARCHAR(64) NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_users ADD COLUMN reset_token_exp DATETIME NULL').catch(() => {});
  await pool.query('ALTER TABLE tribu_users ADD COLUMN foto_url VARCHAR(500) NULL').catch(() => {});

  // Acceso por contraseña a La Tribu
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_access (
      id INT PRIMARY KEY,
      activo BOOLEAN DEFAULT FALSE,
      password VARCHAR(32) NOT NULL,
      mensaje VARCHAR(500) DEFAULT 'Ingresa la contraseña para acceder a La Tribu',
      fecha_renovacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [accRows] = await pool.query('SELECT id FROM tribu_access WHERE id = 1');
  if (accRows.length === 0) {
    const crypto = require('crypto');
    const pwd = crypto.randomBytes(4).toString('hex').toUpperCase();
    await pool.query(
      'INSERT INTO tribu_access (id, activo, password, mensaje) VALUES (1, FALSE, ?, ?)',
      [pwd, 'Ingresa la contraseña para acceder a La Tribu']
    );
  }

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
