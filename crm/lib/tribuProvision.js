const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool, isConfigured } = require('./tribuDb');

const PLAN_PRECIO = 89.9;

function normalizeEmail(email) {
  return email ? String(email).trim().toLowerCase() : '';
}

async function getPlanVipId(conn) {
  const [[plan]] = await conn.execute(
    'SELECT id FROM suscripciones WHERE precio = ? ORDER BY id ASC LIMIT 1',
    [PLAN_PRECIO]
  );
  if (!plan) throw new Error('No existe plan de suscripción S/ 89.90 en La Tribu');
  return plan.id;
}

function generateTempPassword() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function findTribuUserByEmail(email, conn) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const db = conn || getPool();
  const [[row]] = await db.execute(
    'SELECT id, email, psw_temp FROM tribu_users WHERE LOWER(email) = ? LIMIT 1',
    [norm]
  );
  return row || null;
}

async function attachTribuFlagsToPacientes(pacientes) {
  if (!isConfigured() || !pacientes.length) {
    pacientes.forEach(p => { p.tribu_user_id = null; });
    return pacientes;
  }
  const emails = [...new Set(
    pacientes.map(p => normalizeEmail(p.email)).filter(Boolean)
  )];
  if (!emails.length) {
    pacientes.forEach(p => { p.tribu_user_id = null; });
    return pacientes;
  }
  const pool = getPool();
  const placeholders = emails.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT id, LOWER(email) AS email FROM tribu_users WHERE LOWER(email) IN (${placeholders})`,
    emails
  );
  const byEmail = new Map(rows.map(r => [r.email, r.id]));
  pacientes.forEach(p => {
    const em = normalizeEmail(p.email);
    p.tribu_user_id = em ? (byEmail.get(em) || null) : null;
  });
  return pacientes;
}

async function grantManualSubscription(tribuUserId, conn) {
  const planId = await getPlanVipId(conn);
  const grantRef = `crm-grant-${tribuUserId}-${Date.now()}`;

  await conn.execute(
    'UPDATE tribu_suscripciones SET activo = 0, auto_renovacion = 0 WHERE tribu_user_id = ?',
    [tribuUserId]
  );
  const [result] = await conn.execute(
    `INSERT INTO tribu_suscripciones
      (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin,
       culqi_charge_id, auto_renovacion, renovacion_intentos)
     VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), ?, 0, 0)`,
    [tribuUserId, planId, grantRef]
  );
  await conn.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [tribuUserId]);
  return result.insertId;
}

async function createTribuUserFromPaciente(paciente) {
  if (!isConfigured()) throw new Error('Base de datos La Tribu no configurada (TRIBU_DB_NAME)');

  const email = normalizeEmail(paciente.email);
  if (!email) throw new Error('El paciente debe tener email para crear usuario Tribu');

  const existing = await findTribuUserByEmail(email);
  if (existing) throw new Error('Ya existe un usuario Tribu con ese correo');

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 10);
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [insert] = await conn.execute(
      `INSERT INTO tribu_users
        (nombre, apellido, email, telefono, fecha_nacimiento, genero,
         motivo_consulta, fuente, fuente_detalle, estado, password, password_plain, psw_temp, is_suscribed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?, ?, 1, 0)`,
      [
        String(paciente.nombre || '').trim().slice(0, 120),
        String(paciente.apellido || '').trim().slice(0, 120),
        email,
        paciente.telefono ? String(paciente.telefono).trim().slice(0, 30) : null,
        paciente.fecha_nacimiento ? String(paciente.fecha_nacimiento).slice(0, 10) : null,
        paciente.genero || null,
        paciente.motivo_consulta ? String(paciente.motivo_consulta).slice(0, 2000) : null,
        paciente.fuente ? String(paciente.fuente).slice(0, 80) : null,
        paciente.fuente_detalle ? String(paciente.fuente_detalle).slice(0, 200) : null,
        hash,
        tempPassword,
      ]
    );
    const tribuUserId = insert.insertId;
    const suscripcionId = await grantManualSubscription(tribuUserId, conn);
    await conn.commit();
    return { tribuUserId, tempPassword, suscripcionId, email };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Trunca tribu_suscripciones y crea suscripción VIP 1 año para cada tribu_users. */
async function rebuildAllTribuSubscriptions() {
  if (!isConfigured()) throw new Error('Base de datos La Tribu no configurada (TRIBU_DB_NAME)');

  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    await conn.execute('TRUNCATE TABLE tribu_suscripciones');
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    const planId = await getPlanVipId(conn);
    const [users] = await conn.execute('SELECT id FROM tribu_users ORDER BY id ASC');
    let created = 0;
    for (const { id: tribuUserId } of users) {
      const grantRef = `crm-rebuild-${tribuUserId}`;
      await conn.execute(
        `INSERT INTO tribu_suscripciones
          (tribu_user_id, suscripcion_id, activo, fecha_inicio, fecha_fin,
           culqi_charge_id, auto_renovacion, renovacion_intentos)
         VALUES (?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), ?, 0, 0)`,
        [tribuUserId, planId, grantRef]
      );
      await conn.execute('UPDATE tribu_users SET is_suscribed = 1 WHERE id = ?', [tribuUserId]);
      created++;
    }
    await conn.commit();
    return { usuarios: users.length, suscripciones: created };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  isConfigured,
  attachTribuFlagsToPacientes,
  createTribuUserFromPaciente,
  rebuildAllTribuSubscriptions,
  findTribuUserByEmail,
};
