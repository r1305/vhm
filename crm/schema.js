const pool = require('./lib/db');

async function ensureSchema() {
  const conn = await pool.getConnection();
  try {

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

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS citas (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id     INT NOT NULL,
        terapeuta_id    INT NOT NULL,
        fecha           DATE NOT NULL,
        modalidad       ENUM('presencial','videollamada','telefono') NOT NULL DEFAULT 'presencial',
        tipo            ENUM('primera_vez','seguimiento','evaluacion','urgencia') NOT NULL DEFAULT 'seguimiento',
        estado          ENUM('pendiente','confirmada','reagendada','realizada','cancelada','no_show') NOT NULL DEFAULT 'pendiente',
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

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS historial_clinico (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        terapeuta_id INT NOT NULL,
        cita_id      INT DEFAULT NULL,
        fecha        DATE NOT NULL,
        nota         TEXT NOT NULL,
        tipo         ENUM('evolucion','evaluacion','derivacion','alta','otro') NOT NULL DEFAULT 'evolucion',
        privado      TINYINT(1) NOT NULL DEFAULT 1,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id)  REFERENCES pacientes(id)  ON DELETE CASCADE,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE CASCADE,
        FOREIGN KEY (cita_id)      REFERENCES citas(id)      ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

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

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS leads (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        nombre          VARCHAR(120) DEFAULT NULL,
        apellido        VARCHAR(120) DEFAULT NULL,
        email           VARCHAR(150) DEFAULT NULL,
        telefono        VARCHAR(30)  DEFAULT NULL,
        fuente          ENUM('instagram','tiktok','web','whatsapp','referido','otro') NOT NULL DEFAULT 'web',
        fuente_detalle  VARCHAR(300) DEFAULT NULL,
        mensaje         TEXT         DEFAULT NULL,
        estado          ENUM('nuevo','contactado','agendado','convertido','descartado') NOT NULL DEFAULT 'nuevo',
        terapeuta_id    INT          DEFAULT NULL,
        paciente_id     INT          DEFAULT NULL,
        notas           TEXT         DEFAULT NULL,
        utm_source      VARCHAR(200) DEFAULT NULL,
        utm_medium      VARCHAR(200) DEFAULT NULL,
        utm_campaign    VARCHAR(200) DEFAULT NULL,
        utm_content     VARCHAR(200) DEFAULT NULL,
        utm_term        VARCHAR(200) DEFAULT NULL,
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE SET NULL,
        FOREIGN KEY (paciente_id)  REFERENCES pacientes(id)  ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Agregar telefono a terapeutas si no existe
    try { await conn.execute('ALTER TABLE terapeutas ADD COLUMN telefono VARCHAR(30) DEFAULT NULL'); } catch (_) {}
    // Eliminar columnas legacy si existen
    try { await conn.execute('ALTER TABLE pacientes DROP COLUMN fecha_inicio'); } catch (_) {}
    try { await conn.execute('ALTER TABLE pacientes DROP COLUMN sesiones'); } catch (_) {}

    // Tabla de sesiones por paciente
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS paciente_sesiones (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id  INT NOT NULL,
        fecha_inicio DATE DEFAULT NULL,
        sesiones     INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Config del cron de WhatsApp
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cron_config (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        enabled  TINYINT(1) NOT NULL DEFAULT 0,
        hora     TINYINT    NOT NULL DEFAULT 18 COMMENT '0-23',
        minuto   TINYINT    NOT NULL DEFAULT 0  COMMENT '0-59',
        dias     VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5,6' COMMENT 'dias semana cron: 0=dom,1=lun...6=sab',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try { await conn.execute('INSERT IGNORE INTO cron_config (id) VALUES (1)'); } catch (_) {}
    try { await conn.execute('ALTER TABLE cron_config ADD COLUMN mensaje TEXT DEFAULT NULL'); } catch (_) {}

    // Eliminar hora_inicio y hora_fin de citas
    try { await conn.execute('ALTER TABLE citas DROP COLUMN hora_inicio'); } catch (_) {}
    try { await conn.execute('ALTER TABLE citas DROP COLUMN hora_fin'); } catch (_) {}
    // Actualizar labels de tipo en citas (solo cosmético, los valores ENUM no cambian)
    try { await conn.execute("ALTER TABLE citas MODIFY tipo ENUM('primera_vez','seguimiento','evaluacion','urgencia') NOT NULL DEFAULT 'seguimiento'"); } catch (_) {}
    try { await conn.execute("ALTER TABLE citas MODIFY estado ENUM('pendiente','confirmada','reagendada','realizada','cancelada','no_show') NOT NULL DEFAULT 'pendiente'"); } catch (_) {}

    // Agregar columnas UTM si la tabla ya existía sin ellas
    for (const col of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
      try { await conn.execute(`ALTER TABLE leads ADD COLUMN ${col} VARCHAR(200) DEFAULT NULL`); }
      catch (_) {}
    }

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

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS recordatorios (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        paciente_id   INT NOT NULL,
        cita_id       INT DEFAULT NULL,
        tipo          ENUM('recordatorio_cita','seguimiento','reactivacion','newsletter') NOT NULL,
        canal         ENUM('email','whatsapp','ambos') NOT NULL DEFAULT 'email',
        mensaje       TEXT DEFAULT NULL,
        programado_at DATETIME NOT NULL,
        enviado       TINYINT(1) NOT NULL DEFAULT 0,
        enviado_at    TIMESTAMP NULL DEFAULT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (cita_id)     REFERENCES citas(id)     ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS configuracion (
        clave      VARCHAR(100) PRIMARY KEY,
        valor      TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Punto 2: Reglas de asignación automática ───────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS asignacion_reglas (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        terapeuta_id INT NOT NULL,
        keyword      VARCHAR(100) NOT NULL COMMENT 'palabra clave en motivo_consulta',
        prioridad    INT NOT NULL DEFAULT 1,
        activo       TINYINT(1) NOT NULL DEFAULT 1,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (terapeuta_id) REFERENCES terapeutas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Punto 4: Suscriptores newsletter ──────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS suscriptores (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        email       VARCHAR(150) NOT NULL UNIQUE,
        nombre      VARCHAR(120) DEFAULT NULL,
        paciente_id INT DEFAULT NULL,
        segmento    VARCHAR(80)  DEFAULT NULL,
        activo      TINYINT(1) NOT NULL DEFAULT 1,
        ip_origen   VARCHAR(45) DEFAULT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Punto 4: Campañas de email marketing ──────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS campanas_email (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        nombre         VARCHAR(200) NOT NULL,
        asunto         VARCHAR(300) NOT NULL,
        cuerpo_html    LONGTEXT NOT NULL,
        segmento       VARCHAR(80) DEFAULT NULL,
        estado         ENUM('borrador','enviando','completada','cancelada') NOT NULL DEFAULT 'borrador',
        total_enviados INT NOT NULL DEFAULT 0,
        total_abiertos INT NOT NULL DEFAULT 0,
        enviada_at     DATETIME DEFAULT NULL,
        propietario_id INT DEFAULT NULL,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (propietario_id) REFERENCES terapeutas(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Tracker web ───────────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS web_sesiones (
        id           VARCHAR(36) PRIMARY KEY,
        visitor_id   VARCHAR(64) NOT NULL COMMENT 'hash anonimo persistente en localStorage',
        pagina       VARCHAR(500) NOT NULL,
        referrer     VARCHAR(500) DEFAULT NULL,
        utm_source   VARCHAR(200) DEFAULT NULL,
        utm_medium   VARCHAR(200) DEFAULT NULL,
        utm_campaign VARCHAR(200) DEFAULT NULL,
        utm_content  VARCHAR(200) DEFAULT NULL,
        dispositivo  ENUM('desktop','mobile','tablet') NOT NULL DEFAULT 'desktop',
        navegador    VARCHAR(80)  DEFAULT NULL,
        pais         VARCHAR(80)  DEFAULT NULL,
        duracion_seg INT DEFAULT NULL COMMENT 'se actualiza al salir',
        scroll_max   TINYINT DEFAULT 0 COMMENT 'porcentaje maximo scrolleado',
        lead_id      INT DEFAULT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_ws_visitor (visitor_id),
        KEY idx_ws_fecha (created_at),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS web_eventos (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        sesion_id    VARCHAR(36) NOT NULL,
        visitor_id   VARCHAR(64) NOT NULL,
        tipo         ENUM('pageview','click','scroll','form_start','form_submit','conversion','custom') NOT NULL,
        elemento     VARCHAR(300) DEFAULT NULL COMMENT 'selector CSS o texto del elemento',
        pagina       VARCHAR(500) DEFAULT NULL,
        valor        VARCHAR(500) DEFAULT NULL COMMENT 'datos extra del evento',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_we_sesion (sesion_id),
        KEY idx_we_tipo (tipo),
        KEY idx_we_fecha (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Índices adicionales para consultas frecuentes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_leads_fuente ON leads(fuente)',
      'CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha)',
      'CREATE INDEX IF NOT EXISTS idx_citas_terapeuta ON citas(terapeuta_id)',
      'CREATE INDEX IF NOT EXISTS idx_pacientes_terapeuta ON pacientes(terapeuta_id)',
      'CREATE INDEX IF NOT EXISTS idx_pacientes_estado ON pacientes(estado)',
    ];
    for (const sql of indexes) {
      try { await conn.execute(sql); } catch (_) {}
    }

    // Seed superadmin ────────────────────────────────────────────
    const bcrypt = require('bcryptjs');
    const [[existing]] = await conn.execute(
      "SELECT id FROM terapeutas WHERE username = 'CRM' LIMIT 1"
    );
    if (!existing) {
      const hash = await bcrypt.hash('$CRM$2026$', 12);
      await conn.execute(
        `INSERT INTO terapeutas (nombre, apellido, username, email, password, rol)
         VALUES ('CRM', 'Admin', 'CRM', 'admin@vhm.com.pe', ?, 'superadmin')`,
        [hash]
      );
      console.log('[crm] Superadmin creado: CRM / $CRM$2026$');
    }

    // ── Permisos de menú por rol ────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS menu_permisos (
        rol   ENUM('superadmin','recepcion','terapeuta') NOT NULL,
        item  VARCHAR(50) NOT NULL,
        PRIMARY KEY (rol, item)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Defaults: si la tabla está vacía, insertar permisos base
    const [[{cnt}]] = await conn.execute('SELECT COUNT(*) AS cnt FROM menu_permisos');
    if (!cnt) {
      const defaults = [
        ...['dashboard','agenda','pacientes','leads','historial','consentimientos','pagos','espera','terapeutas','reportes','analitica','marketing','asignacion','integraciones','permisos_menu'].map(i => ['superadmin', i]),
        ...['dashboard','agenda','pacientes','leads','historial','consentimientos','pagos','espera','terapeutas','reportes','analitica','marketing','asignacion','integraciones'].map(i => ['recepcion', i]),
        ...['agenda','pacientes','historial','mi_reporte'].map(i => ['terapeuta', i]),
      ];
      for (const [rol, item] of defaults)
        await conn.execute('INSERT IGNORE INTO menu_permisos (rol, item) VALUES (?,?)', [rol, item]);
    }

    console.log('[crm] Schema OK');
  } finally {
    conn.release();
  }
}

module.exports = { ensureSchema };
