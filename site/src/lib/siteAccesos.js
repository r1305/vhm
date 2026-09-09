const pool = require('../db');

const CATALOG_SEED = [
  { clave: 'reclamos', nombre: 'Reclamos', descripcion: 'Libro de reclamaciones', seccion: 'principal', orden: 1 },
  { clave: 'testimonios', nombre: 'Testimonios', descripcion: 'Gestión de testimonios', seccion: 'principal', orden: 2 },
  { clave: 'videos', nombre: 'La Tribu', descripcion: 'Videos, categorías y landing', seccion: 'principal', orden: 3 },
  { clave: 'tribu-users', nombre: 'Usuarios Tribu', descripcion: 'Miembros de La Tribu', seccion: 'principal', orden: 4 },
  { clave: 'usuarios', nombre: 'Administradores', descripcion: 'Usuarios del panel admin', seccion: 'config', orden: 5 },
  { clave: 'config', nombre: 'Ajustes', descripcion: 'Configuración del sitio', seccion: 'config', orden: 6 },
  { clave: 'accesos', nombre: 'Accesos', descripcion: 'Permisos de vistas por usuario', seccion: 'config', orden: 7 },
];

const DEFAULTS_ADMIN = ['reclamos', 'testimonios', 'videos', 'tribu-users', 'usuarios'];

async function ensureAccesosSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_menu_accesos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clave VARCHAR(80) NOT NULL UNIQUE,
      nombre VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NULL,
      seccion ENUM('principal','config') NOT NULL DEFAULT 'principal',
      orden INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_menu_accesos (
      usuario_id INT NOT NULL,
      acceso_id INT NOT NULL,
      PRIMARY KEY (usuario_id, acceso_id),
      KEY idx_uma_acceso (acceso_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  for (const item of CATALOG_SEED) {
    await pool.query(
      `INSERT INTO site_menu_accesos (clave, nombre, descripcion, seccion, orden)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), descripcion = VALUES(descripcion),
         seccion = VALUES(seccion), orden = VALUES(orden)`,
      [item.clave, item.nombre, item.descripcion, item.seccion, item.orden]
    );
  }
}

async function getAllCatalog() {
  const [rows] = await pool.execute(
    'SELECT id, clave, nombre, descripcion, seccion, orden FROM site_menu_accesos ORDER BY orden ASC, id ASC'
  );
  return rows;
}

async function getAllClaves() {
  const catalog = await getAllCatalog();
  return catalog.map((c) => c.clave);
}

function sanitizeClaves(items, catalogClaves) {
  if (!Array.isArray(items)) return [];
  const allowed = new Set(catalogClaves);
  return [...new Set(items.filter((i) => allowed.has(i)))];
}

async function getAccesosForUser(userId, rol) {
  const catalogClaves = await getAllClaves();
  if (rol === 'SUPER_ADMIN') return catalogClaves;

  const [rows] = await pool.execute(
    `SELECT a.clave
     FROM usuario_menu_accesos u
     INNER JOIN site_menu_accesos a ON a.id = u.acceso_id
     WHERE u.usuario_id = ?
     ORDER BY a.orden ASC, a.id ASC`,
    [userId]
  );
  if (rows.length) return rows.map((r) => r.clave);
  return DEFAULTS_ADMIN.filter((c) => catalogClaves.includes(c));
}

async function setAccesosForUser(userId, claves, targetRol) {
  if (targetRol === 'SUPER_ADMIN') {
    throw new Error('Los permisos del Super Admin no pueden modificarse');
  }

  const catalog = await getAllCatalog();
  const catalogClaves = catalog.map((c) => c.clave);
  const safe = sanitizeClaves(claves, catalogClaves).filter((c) => c !== 'accesos');

  await pool.execute('DELETE FROM usuario_menu_accesos WHERE usuario_id = ?', [userId]);
  for (const clave of safe) {
    const acceso = catalog.find((c) => c.clave === clave);
    if (!acceso) continue;
    await pool.execute(
      'INSERT IGNORE INTO usuario_menu_accesos (usuario_id, acceso_id) VALUES (?, ?)',
      [userId, acceso.id]
    );
  }
  return safe;
}

async function seedAccesosForUser(userId, rol) {
  const [existing] = await pool.execute(
    'SELECT acceso_id FROM usuario_menu_accesos WHERE usuario_id = ? LIMIT 1',
    [userId]
  );
  if (existing.length || rol === 'SUPER_ADMIN') return;

  const defaults = DEFAULTS_ADMIN;
  await setAccesosForUser(userId, defaults, rol);
}

async function listUsersWithAccesos() {
  const [users] = await pool.execute(
    `SELECT id, username, nombre, email, rol, activo, es_protegido
     FROM usuarios
     ORDER BY activo DESC, nombre ASC, username ASC`
  );
  const catalogClaves = await getAllClaves();
  const [permRows] = await pool.execute(
    `SELECT u.usuario_id, a.clave
     FROM usuario_menu_accesos u
     INNER JOIN site_menu_accesos a ON a.id = u.acceso_id
     ORDER BY u.usuario_id, a.orden`
  );
  const byUser = {};
  for (const r of permRows) {
    if (!byUser[r.usuario_id]) byUser[r.usuario_id] = [];
    byUser[r.usuario_id].push(r.clave);
  }

  return users.map((u) => ({
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    activo: u.activo,
    es_protegido: u.es_protegido,
    items: u.rol === 'SUPER_ADMIN'
      ? catalogClaves
      : (byUser[u.id] || DEFAULTS_ADMIN.filter((c) => catalogClaves.includes(c))),
    editable: u.rol !== 'SUPER_ADMIN' && !u.es_protegido,
  }));
}

async function backfillAccesos() {
  const [users] = await pool.query('SELECT id, rol FROM usuarios');
  for (const u of users) {
    await seedAccesosForUser(u.id, u.rol);
  }
}

module.exports = {
  CATALOG_SEED,
  DEFAULTS_ADMIN,
  ensureAccesosSchema,
  backfillAccesos,
  getAllCatalog,
  getAllClaves,
  getAccesosForUser,
  setAccesosForUser,
  seedAccesosForUser,
  listUsersWithAccesos,
  sanitizeClaves,
};
