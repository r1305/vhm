const pool = require('./db');

const HIDDEN_MENU_ITEMS = ['pagos'];

async function getCatalog() {
  const [rows] = await pool.execute(
    `SELECT id, clave, label, icon, orden FROM crm_menu_items
     WHERE clave NOT IN (${HIDDEN_MENU_ITEMS.map(() => '?').join(',')})
     ORDER BY orden ASC`,
    HIDDEN_MENU_ITEMS
  );
  return rows;
}

async function getAllClaves() {
  const catalog = await getCatalog();
  return catalog.map(c => c.clave);
}

function sanitizeItems(claves, catalogClaves) {
  if (!Array.isArray(claves)) return [];
  const allowed = new Set(catalogClaves);
  return [...new Set(claves.filter(i => allowed.has(i)))];
}

async function getMenuPermisosForUser(userId, rol) {
  const catalog = await getCatalog();
  const allClaves = catalog.map(c => c.clave);

  if (rol === 'superadmin') return new Set(allClaves);

  const [rows] = await pool.execute(
    `SELECT m.clave FROM crm_usuario_menu_accesos a
     INNER JOIN crm_menu_items m ON m.id = a.menu_id
     WHERE a.terapeuta_id = ? ORDER BY m.orden ASC`,
    [userId]
  );
  if (rows.length) {
    const items = new Set(rows.map(r => r.clave));
    items.delete('permisos_menu');
    for (const h of HIDDEN_MENU_ITEMS) items.delete(h);
    return items;
  }
  // fallback: permisos del rol desde menu_permisos
  const [rolRows] = await pool.execute('SELECT item FROM menu_permisos WHERE rol = ?', [rol]);
  const items = new Set(rolRows.map(r => r.item).filter(i => allClaves.includes(i)));
  items.delete('permisos_menu');
  for (const h of HIDDEN_MENU_ITEMS) items.delete(h);
  return items;
}

async function setMenuPermisosForUser(userId, claves, rol) {
  const catalog = await getCatalog();
  const allClaves = catalog.map(c => c.clave);
  let safe = sanitizeItems(claves, allClaves).filter(i => !HIDDEN_MENU_ITEMS.includes(i));
  if (rol === 'superadmin') {
    if (!safe.includes('permisos_menu')) safe.push('permisos_menu');
  } else {
    safe = safe.filter(i => i !== 'permisos_menu');
  }

  await pool.execute('DELETE FROM crm_usuario_menu_accesos WHERE terapeuta_id = ?', [userId]);
  for (const clave of safe) {
    const item = catalog.find(c => c.clave === clave);
    if (!item) continue;
    await pool.execute(
      'INSERT IGNORE INTO crm_usuario_menu_accesos (terapeuta_id, menu_id) VALUES (?, ?)',
      [userId, item.id]
    );
  }
  return safe;
}

async function seedMenuPermisosFromRol(userId, rol) {
  const [existing] = await pool.execute(
    'SELECT menu_id FROM crm_usuario_menu_accesos WHERE terapeuta_id = ? LIMIT 1', [userId]
  );
  if (existing.length) return;
  const [rolRows] = await pool.execute('SELECT item FROM menu_permisos WHERE rol = ?', [rol]);
  await setMenuPermisosForUser(userId, rolRows.map(r => r.item), rol);
}

async function copyMenuPermisosFromRolTemplate(userId, rol) {
  const [rolRows] = await pool.execute('SELECT item FROM menu_permisos WHERE rol = ?', [rol]);
  return setMenuPermisosForUser(userId, rolRows.map(r => r.item), rol);
}

async function listUsersWithPermisos() {
  const [users] = await pool.execute(
    'SELECT id, nombre, apellido, username, rol, activo FROM terapeutas ORDER BY activo DESC, nombre, apellido'
  );
  const [permRows] = await pool.execute(
    `SELECT a.terapeuta_id, m.clave FROM crm_usuario_menu_accesos a
     INNER JOIN crm_menu_items m ON m.id = a.menu_id
     ORDER BY a.terapeuta_id, m.orden`
  );
  const byUser = {};
  for (const r of permRows) {
    if (!byUser[r.terapeuta_id]) byUser[r.terapeuta_id] = [];
    byUser[r.terapeuta_id].push(r.clave);
  }
  return users.map(u => ({
    id: u.id, nombre: u.nombre, apellido: u.apellido,
    username: u.username, rol: u.rol, activo: u.activo,
    items: byUser[u.id] || [],
  }));
}

module.exports = {
  HIDDEN_MENU_ITEMS,
  getCatalog,
  getAllClaves,
  getMenuPermisosForUser,
  setMenuPermisosForUser,
  seedMenuPermisosFromRol,
  copyMenuPermisosFromRolTemplate,
  listUsersWithPermisos,
  sanitizeItems,
};
