const pool = require('./db');

const ALL_MENU_ITEMS = [
  'dashboard', 'agenda', 'calendario', 'pacientes', 'whatsapp', 'mi_reporte',
  'disponibilidad', 'historial', 'pagos', 'analitica', 'integraciones',
  'terapeutas', 'reportes', 'permisos_menu',
];

const STAFF_DEFAULTS = [
  'dashboard', 'agenda', 'calendario', 'disponibilidad', 'pacientes', 'whatsapp',
  'historial', 'pagos', 'analitica', 'integraciones', 'terapeutas', 'reportes',
];

const DEFAULTS_BY_ROL = {
  superadmin: ALL_MENU_ITEMS,
  admin: STAFF_DEFAULTS,
  recepcion: STAFF_DEFAULTS,
  terapeuta: ['agenda', 'calendario', 'disponibilidad', 'pacientes', 'historial', 'mi_reporte'],
};

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.filter(i => ALL_MENU_ITEMS.includes(i)))];
}

async function getMenuPermisosForUser(userId, rol) {
  const [rows] = await pool.execute(
    'SELECT item FROM usuario_menu_permisos WHERE terapeuta_id = ?',
    [userId]
  );
  if (rows.length) {
    const items = new Set(rows.map(r => r.item));
    if (rol === 'superadmin') {
      items.add('permisos_menu');
    } else {
      items.delete('permisos_menu');
    }
    return items;
  }
  return new Set(DEFAULTS_BY_ROL[rol] || DEFAULTS_BY_ROL.terapeuta);
}

async function setMenuPermisosForUser(userId, items, rol) {
  let safe = sanitizeItems(items);
  if (rol === 'superadmin') {
    if (!safe.includes('permisos_menu')) safe.push('permisos_menu');
  } else {
    safe = safe.filter(i => i !== 'permisos_menu');
  }

  await pool.execute('DELETE FROM usuario_menu_permisos WHERE terapeuta_id = ?', [userId]);
  for (const item of safe) {
    await pool.execute(
      'INSERT IGNORE INTO usuario_menu_permisos (terapeuta_id, item) VALUES (?, ?)',
      [userId, item]
    );
  }
  return safe;
}

async function seedMenuPermisosFromRol(userId, rol) {
  const [existing] = await pool.execute(
    'SELECT item FROM usuario_menu_permisos WHERE terapeuta_id = ? LIMIT 1',
    [userId]
  );
  if (existing.length) return;

  const items = DEFAULTS_BY_ROL[rol] || DEFAULTS_BY_ROL.terapeuta;
  for (const item of items) {
    await pool.execute(
      'INSERT IGNORE INTO usuario_menu_permisos (terapeuta_id, item) VALUES (?, ?)',
      [userId, item]
    );
  }
}

async function copyMenuPermisosFromRolTemplate(userId, rol) {
  const [roleRows] = await pool.execute('SELECT item FROM menu_permisos WHERE rol = ?', [rol]);
  const items = roleRows.length
    ? roleRows.map(r => r.item)
    : (DEFAULTS_BY_ROL[rol] || DEFAULTS_BY_ROL.terapeuta);
  return setMenuPermisosForUser(userId, items, rol);
}

async function listUsersWithPermisos() {
  const [users] = await pool.execute(
    `SELECT id, nombre, apellido, username, rol, activo
     FROM terapeutas
     ORDER BY activo DESC, nombre, apellido`
  );
  const [permRows] = await pool.execute(
    'SELECT terapeuta_id, item FROM usuario_menu_permisos ORDER BY terapeuta_id, item'
  );
  const byUser = {};
  for (const r of permRows) {
    if (!byUser[r.terapeuta_id]) byUser[r.terapeuta_id] = [];
    byUser[r.terapeuta_id].push(r.item);
  }
  return users.map(u => ({
    id: u.id,
    nombre: u.nombre,
    apellido: u.apellido,
    username: u.username,
    rol: u.rol,
    activo: u.activo,
    items: byUser[u.id] || [],
  }));
}

module.exports = {
  ALL_MENU_ITEMS,
  DEFAULTS_BY_ROL,
  getMenuPermisosForUser,
  setMenuPermisosForUser,
  seedMenuPermisosFromRol,
  copyMenuPermisosFromRolTemplate,
  listUsersWithPermisos,
  sanitizeItems,
};
