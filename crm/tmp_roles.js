const { ensureSchema } = require('./schema');
const roles = require('./lib/roles');
const db = require('./lib/db');

(async () => {
  await ensureSchema();
  console.log('SCHEMA OK');
  const [mp] = await db.execute("SELECT DISTINCT rol FROM menu_permisos WHERE item = 'terapeutas'");
  console.log('menu_permisos terapeutas por rol:', mp.map(r => r.rol).join(', '));

  const admin = { rol: 'admin', id: 7 };
  console.log('admin asigna admin:', roles.canAssignRole('admin', 'admin'));
  console.log('admin asigna terapeuta:', roles.canAssignRole('admin', 'terapeuta'));
  console.log('admin asigna recepcion:', roles.canAssignRole('admin', 'recepcion'));
  console.log('admin asigna superadmin:', roles.canAssignRole('admin', 'superadmin'));
  console.log('admin gestiona admin:', roles.canManageUser(admin, { id: 8, rol: 'admin' }));
  console.log('admin gestiona terapeuta:', roles.canManageUser(admin, { id: 2, rol: 'terapeuta' }));
  console.log('admin gestiona recepcion:', roles.canManageUser(admin, { id: 99, rol: 'recepcion' }));
  console.log('admin gestiona superadmin:', roles.canManageUser(admin, { id: 1, rol: 'superadmin' }));
  console.log('recepcion asigna admin:', roles.canAssignRole('recepcion', 'admin'));
  console.log('listFilter admin:', roles.listFilterForRole('admin', 7));
  console.log('listFilter recepcion:', roles.listFilterForRole('recepcion', 9));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });