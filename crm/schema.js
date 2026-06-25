const pool = require('./lib/db');

async function ensureSchema() {
  const conn = await pool.getConnection();
  try {

    // ── Terapeutas / usuarios del sistema ─────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS terapeutas (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        nombre      VARCHAR(120) NOT NULL,
        apellido    VARCHAR(120) NOT NULL,
        username    VARCHAR(50)  NOT NULL UNIQUE,
        email       VARCHAR(150) DEFAULT NULL,
        password    VARCHAR(255) NOT NULL,
        rol         ENUM('superadmin','terapeuta','recepcion') NOT NULL DEFAULT 'terapeuta',
        especialidad VARCHAR(200) DEFAULT NULL,
        bio         TEXT DEFAULT NULL,
        activo      TINYINT(1) NOT NULL DEFAULT 1,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Pacientes ──────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS pacientes (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        nombre          VARCHAR(120) NOT NULL,
        apellido        VARCHAR(120) NOT NULL,
        email           VARCHAR(150) DEFAULT NULL,
        telefono        VARCHAR(30)  DEFAULT NULL,
        fecha_nacimiento DATE        DEFAULT NULL,
        genero          ENUM('masculino','femenino','otro','prefiero_no_decir') DEFAULT NULL,
        direccion       VARCHAR(255) DEFAULT NULL,
        motivo_consulta TEXT         DEFAULT NULL,
        fuente          VARCHAR(80)  DEFAULT NULL,
        fuente_detalle  VARCHAR(200) DEFAULT NULL,
        terapeuta_id    INT          DEFAULT NULL,
        estado          ENUM('prospecto','activo','alta','inactivo','lista_espera') NOT NULL DEFAULT 'prospecto',
        consentimiento  TINYINT(1)   NOT NULL DEFAULT 0,
        consentimiento_at TIMESTAMP  NULL DEFAULT NULL,
        notas_internas  TEXT         DEFAULT NULL,
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Disponibilidad semanal del terapeuta ───────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS disponibilidad (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        terapeuta_id INT NOT NULL,
        dia_semana   TINYINT NOT NULL COMMENT '0=lun,1=mar,...,6=dom',
        hora_inicio  TIME NOT NULL,
        hora_fin     TIME NOT NULL,
        activo       TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Citas ──────────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS citas (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id     INT NOT NULL,
        terapeuta_id    INT NOT NULL,
        fecha           DATE NOT NULL,
        hora_inicio     TIME NOT NULL,
        hora_fin        TIME NOT NULL,
        modalidad       ENUM('presencial','videollamada','telefono') NOT NULL DEFAULT 'presencial',
        tipo            ENUM('primera_vez','seguimiento','evaluacion','urgencia') NOT NULL DEFAULT 'seguimiento',
        estado          ENUM('pendiente','confirmada','realizada','cancelada','no_show') NOT NULL DEFAULT 'pendiente',
        notas           TEXT DEFAULT NULL,
        recordatorio_24h TINYINT(1) NOT NULL DEFAULT 0,
        recordatorio_48h TINYINT(1) NOT NULL DEFAULT 0,
        monto           DECIMAL(8,2) DEFAULT NULL,
        pagado          TINYINT(1) NOT NULL DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id)  REFERENCES pacientes(id)  ON DELETE CASCADE,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE CASCADE,
        KEY idx_citas_fecha (fecha),
        KEY idx_citas_terapeuta (terapeuta_id),
        KEY idx_citas_paciente (paciente_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Historial clínico (notas de sesión) ────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS historial_clinico (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        terapeuta_id INT NOT NULL,
        cita_id      INT DEFAULT NULL,
        fecha        DATE NOT NULL,
        nota         TEXT NOT NULL COMMENT 'encriptado en app layer',
        tipo         ENUM('evolucion','evaluacion','derivacion','alta','otro') NOT NULL DEFAULT 'evolucion',
        privado      TINYINT(1) NOT NULL DEFAULT 1,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id)  REFERENCES pacientes(id)  ON DELETE CASCADE,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE CASCADE,
        FOREIGN KEY (cita_id)      REFERENCES citas(id)       ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Lista de espera ────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS lista_espera (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        terapeuta_id INT DEFAULT NULL,
        especialidad VARCHAR(200) DEFAULT NULL,
        fecha_solicitud TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notificado   TINYINT(1) NOT NULL DEFAULT 0,
        notificado_at TIMESTAMP NULL DEFAULT NULL,
        activo       TINYINT(1) NOT NULL DEFAULT 1,
        FOREIGN KEY (paciente_id)  REFERENCES pacientes(id)  ON DELETE CASCADE,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Pagos ──────────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS pagos (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        cita_id      INT DEFAULT NULL,
        monto        DECIMAL(8,2) NOT NULL,
        moneda       VARCHAR(3) NOT NULL DEFAULT 'PEN',
        metodo       ENUM('efectivo','transferencia','yape','plin','tarjeta','otro') NOT NULL DEFAULT 'transferencia',
        estado       ENUM('pendiente','completado','reembolsado','fallido') NOT NULL DEFAULT 'pendiente',
        referencia   VARCHAR(100) DEFAULT NULL,
        notas        VARCHAR(500) DEFAULT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (cita_id)     REFERENCES citas(id)     ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Packs / suscripciones de sesiones ─────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS packs (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        nombre       VARCHAR(120) NOT NULL,
        sesiones_total INT NOT NULL DEFAULT 4,
        sesiones_usadas INT NOT NULL DEFAULT 0,
        monto_total  DECIMAL(8,2) NOT NULL,
        pagado       TINYINT(1) NOT NULL DEFAULT 0,
        activo       TINYINT(1) NOT NULL DEFAULT 1,
        vence_at     DATE DEFAULT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Leads (prospectos de redes sociales y web) ─────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS leads (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        nombre       VARCHAR(120) DEFAULT NULL,
        apellido     VARCHAR(120) DEFAULT NULL,
        email        VARCHAR(150) DEFAULT NULL,
        telefono     VARCHAR(30)  DEFAULT NULL,
        fuente       ENUM('instagram','tiktok','web','whatsapp','referido','otro') NOT NULL DEFAULT 'web',
        fuente_detalle VARCHAR(300) DEFAULT NULL COMMENT 'URL del post/reel/video de origen',
        mensaje      TEXT         DEFAULT NULL,
        estado       ENUM('nuevo','contactado','agendado','convertido','descartado') NOT NULL DEFAULT 'nuevo',
        terapeuta_id INT          DEFAULT NULL,
        paciente_id  INT          DEFAULT NULL COMMENT 'si fue convertido',
        notas        TEXT         DEFAULT NULL,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE SET NULL,
        FOREIGN KEY (paciente_id)  REFERENCES pacientes(id)  ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Consentimientos informados ─────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS consentimientos (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        tipo         VARCHAR(80) NOT NULL DEFAULT 'terapeutico',
        texto        TEXT NOT NULL,
        firmado      TINYINT(1) NOT NULL DEFAULT 0,
        firmado_at   TIMESTAMP NULL DEFAULT NULL,
        ip_firma     VARCHAR(45) DEFAULT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Recordatorios / follow-ups automáticos ─────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS recordatorios (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        cita_id      INT DEFAULT NULL,
        tipo         ENUM('recordatorio_cita','seguimiento','reactivacion','newsletter') NOT NULL,
        canal        ENUM('email','whatsapp','ambos') NOT NULL DEFAULT 'email',
        mensaje      TEXT DEFAULT NULL,
        programado_at DATETIME NOT NULL,
        enviado      TINYINT(1) NOT NULL DEFAULT 0,
        enviado_at   TIMESTAMP NULL DEFAULT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (cita_id)     REFERENCES citas(id)     ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Configuración general (clave-valor) ────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS configuracion (
        clave      VARCHAR(100) PRIMARY KEY,
        valor      TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Seed: terapeuta superadmin por defecto ─────────────────────
    const bcrypt = require('bcryptjs');
    const [[existing]] = await conn.execute(
      "SELECT id FROM terapeutas WHERE username = 'CRM' LIMIT 1"
    );
    if (!existing) {
      const hash = await bcrypt.hash('$CRM$2026', 10);
      await conn.execute(
        `INSERT INTO terapeutas (nombre, apellido, username, email, password, rol)
         VALUES ('CRM', 'Admin', 'CRM', 'admin@vhm.com.pe', ?, 'superadmin')`,
        [hash]
      );
      console.log('[crm] Superadmin creado: CRM / $CRM$2026');
    }

    console.log('[crm] Schema OK');
  } finally {
    conn.release();
  }
}

module.exports = { ensureSchema };
