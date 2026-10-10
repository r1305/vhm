const pool = require('../db');

const MAX_INTENTOS_RENOVACION = 4;

function graciaDias() {
  const n = Number.parseInt(process.env.TRIBU_GRACIA_DIAS, 10);
  return Number.isFinite(n) && n >= 0 && n <= 30 ? n : 3;
}

function accesoVigenteSql(alias = 'ts') {
  const a = alias ? `${alias}.` : '';
  const g = graciaDias();
  return `(${a}activo = 1 AND (${a}fecha_fin >= CURDATE() OR (
    ((${a}auto_renovacion = 1 AND ${a}renovacion_intentos < ${MAX_INTENTOS_RENOVACION}) OR ${a}pendiente_conciliar = 1)
    AND ${a}fecha_fin >= CURDATE() - INTERVAL ${g} DAY)))`;
}

async function usuarioTieneAcceso(userId) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM tribu_suscripciones ts
      WHERE ts.tribu_user_id = ? AND ${accesoVigenteSql('ts')}`,
    [userId]
  );
  return (row?.total || 0) > 0;
}

async function sincronizarIsSuscribed(userId) {
  const subscribed = await usuarioTieneAcceso(userId);
  const flag = subscribed ? 1 : 0;
  await pool.execute(
    'UPDATE tribu_users SET is_suscribed = ? WHERE id = ? AND is_suscribed <> ?',
    [flag, userId, flag]
  );
  return subscribed;
}

module.exports = {
  MAX_INTENTOS_RENOVACION,
  graciaDias,
  accesoVigenteSql,
  usuarioTieneAcceso,
  sincronizarIsSuscribed,
};
