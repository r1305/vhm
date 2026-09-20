const pool = require('./db');
const { ensureAccesosSchema, backfillAccesos } = require('./lib/accesos');

const LANDING_INTRO_DEFAULT = 'Cada masterclass que encontrarás aquí nació de historias reales. No estás entrando a ver "contenido": estás entrando a un espacio pensado para devolverte claridad, fuerza y dirección cuando más lo necesitas.';
const LANDING_PACTO_DEFAULT = 'Cada recurso tiene un propósito: ayudarte a entender, soltar, ordenar, sanar y avanzar. Lo importante no es la velocidad, sino tu constancia.';

let readyPromise = null;

function ensureSchema() {
  if (!readyPromise) {
    readyPromise = crearEsquema().catch(err => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

async function crearEsquema() {
  // ── Administradores ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(150) NULL,
      rol ENUM('SUPER_ADMIN','ADMIN') NOT NULL DEFAULT 'ADMIN',
      activo TINYINT(1) NOT NULL DEFAULT 1,
      es_protegido TINYINT(1) NOT NULL DEFAULT 0,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Usuarios de La Tribu ──
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
      psw_temp         TINYINT(1)   NOT NULL DEFAULT 1,
      password_plain   VARCHAR(20)  NULL,
      reset_token      VARCHAR(64)  NULL,
      reset_token_exp  DATETIME     NULL,
      foto_url         VARCHAR(500) NULL,
      is_suscribed     TINYINT(1)   NOT NULL DEFAULT 0,
      created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Suscripciones ──
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

  const [planRows] = await pool.query('SELECT COUNT(*) AS total FROM suscripciones');
  if (planRows[0].total === 0) {
    await pool.query(
      `INSERT INTO suscripciones (nombre, precio, descripcion) VALUES
        ('Plan Base', 39.90, 'Próximamente'),
        ('Plan VIP', 89.90, 'Próximamente')`
    );
  }

  // ── Suscripciones activas ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_suscripciones (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      tribu_user_id   INT NOT NULL,
      suscripcion_id  INT NOT NULL,
      fecha_inicio    DATE NOT NULL,
      fecha_fin       DATE NOT NULL,
      activo          TINYINT(1) NOT NULL DEFAULT 1,
      auto_renovacion TINYINT(1) NOT NULL DEFAULT 1,
      cancelada_at    TIMESTAMP NULL,
      renovacion_intentos INT NOT NULL DEFAULT 0,
      next_renovacion_intento DATETIME NULL,
      culqi_charge_id VARCHAR(64) NULL,
      culqi_customer_id VARCHAR(64) NULL,
      culqi_card_id   VARCHAR(64) NULL,
      culqi_card_brand VARCHAR(32) NULL,
      mp_payment_id   VARCHAR(64) NULL,
      mp_preapproval_id VARCHAR(64) NULL,
      mp_order_id     VARCHAR(64) NULL,
      mp_customer_id  VARCHAR(64) NULL,
      mp_card_id      VARCHAR(64) NULL,
      mp_card_brand   VARCHAR(32) NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ts_user (tribu_user_id),
      KEY idx_ts_fin (fecha_fin),
      KEY idx_ts_culqi_charge (culqi_charge_id),
      FOREIGN KEY (tribu_user_id) REFERENCES tribu_users(id) ON DELETE CASCADE,
      FOREIGN KEY (suscripcion_id) REFERENCES suscripciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Culqi ──
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

  // ── Payer profiles ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_payer_profiles (
      tribu_user_id INT NOT NULL PRIMARY KEY,
      identification_type VARCHAR(10) NULL,
      identification_number VARCHAR(20) NULL,
      billing_email VARCHAR(150) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (tribu_user_id) REFERENCES tribu_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Saved cards ──
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

  // ── Payment events ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_culqi_payment_events (
      culqi_charge_id VARCHAR(64) NOT NULL PRIMARY KEY,
      tribu_suscripcion_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_tcpe_sub (tribu_suscripcion_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Transaction log ──
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

  // ── Acceso por contraseña ──
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

  // ── Videos ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_categorias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NULL,
      orden INT DEFAULT 1,
      activo BOOLEAN DEFAULT TRUE,
      creado_por INT NULL,
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
      creado_por INT NULL,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_videos_categoria (categoria_id),
      KEY idx_videos_activo (activo),
      CONSTRAINT fk_video_categoria FOREIGN KEY (categoria_id)
        REFERENCES video_categorias(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [catRows] = await pool.query('SELECT COUNT(*) AS total FROM video_categorias');
  if (catRows[0].total === 0) {
    await pool.query(
      `INSERT INTO video_categorias (nombre, descripcion, orden, activo) VALUES
        ('Sanación Emocional', 'Herramientas para entender, soltar y sanar lo que hoy te pesa.', 1, TRUE),
        ('Neurociencias & Regulación', 'Estrategias desde la neurociencia para regular tu sistema nervioso.', 2, TRUE),
        ('Narcisismo', 'Cómo identificar y protegerte de relaciones dañinas.', 3, TRUE)`
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_landing (
      id INT PRIMARY KEY,
      intro TEXT NULL,
      pacto TEXT NULL,
      hero_video_url VARCHAR(500) NULL,
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

  // ── Eventos ──
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
      creado_por INT NULL,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_eventos_fecha (fecha),
      KEY idx_eventos_activo (activo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Testimonios ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      autor VARCHAR(120) NULL,
      texto TEXT NULL,
      foto_url VARCHAR(500) NULL,
      orden INT NOT NULL DEFAULT 0,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonios_config (
      id INT PRIMARY KEY DEFAULT 1,
      seccion_activa BOOLEAN DEFAULT TRUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [tcfg] = await pool.query('SELECT id FROM testimonios_config WHERE id = 1');
  if (tcfg.length === 0) await pool.query('INSERT INTO testimonios_config (id, seccion_activa) VALUES (1, TRUE)');

  // ── Plantillas ──
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

  // ── Encuestas ──
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
      tipo ENUM('single','multiple','text') NOT NULL DEFAULT 'single',
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
      opcion_id INT NULL,
      texto_respuesta TEXT NULL,
      KEY idx_erd_respuesta (respuesta_id),
      KEY idx_erd_pregunta (pregunta_id),
      KEY idx_erd_opcion (opcion_id),
      CONSTRAINT fk_erd_respuesta FOREIGN KEY (respuesta_id) REFERENCES encuesta_respuestas(id) ON DELETE CASCADE,
      CONSTRAINT fk_erd_pregunta FOREIGN KEY (pregunta_id) REFERENCES encuesta_preguntas(id) ON DELETE CASCADE,
      CONSTRAINT fk_erd_opcion FOREIGN KEY (opcion_id) REFERENCES encuesta_opciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Config general ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tribu_config (
      id INT PRIMARY KEY,
      pixel_id VARCHAR(50) NULL,
      pixel_activo TINYINT(1) NOT NULL DEFAULT 0,
      whatsapp_numero VARCHAR(30) NULL,
      whatsapp_mensaje VARCHAR(500) NULL,
      whatsapp_activo TINYINT(1) NOT NULL DEFAULT 0,
      instagram VARCHAR(200) NULL,
      facebook VARCHAR(200) NULL,
      youtube VARCHAR(200) NULL,
      tiktok VARCHAR(200) NULL,
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [cfgRows] = await pool.query('SELECT id FROM tribu_config WHERE id = 1');
  if (cfgRows.length === 0) {
    await pool.query('INSERT INTO tribu_config (id) VALUES (1)');
  }

  await ensureAccesosSchema();
  await backfillAccesos();
}

module.exports = { ensureSchema, LANDING_INTRO_DEFAULT, LANDING_PACTO_DEFAULT };
