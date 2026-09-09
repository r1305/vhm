/** Roles y reglas de quién puede gestionar a quién */

const ALL_ROLES = ['superadmin', 'admin', 'recepcion', 'terapeuta'];

const ROLE_LABELS = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  recepcion: 'Recepción',
  terapeuta: 'Terapeuta',
};

/** Roles con acceso administrativo al CRM (no terapeuta) */
const STAFF_ADMIN_ROLES = ['superadmin', 'admin', 'recepcion'];

/** Roles privilegiados: no gestionables por admin/recepcion */
const PRIVILEGED_ROLES = ['superadmin', 'admin', 'recepcion'];

function isSuperAdmin(rol) {
  return rol === 'superadmin';
}

function isStaffAdmin(rol) {
  return STAFF_ADMIN_ROLES.includes(rol);
}

function assignableRoles(actorRol) {
  if (actorRol === 'superadmin') return ALL_ROLES;
  if (actorRol === 'admin' || actorRol === 'recepcion') return ['terapeuta'];
  return [];
}

function canAssignRole(actorRol, targetRol) {
  return assignableRoles(actorRol).includes(targetRol);
}

function canManageUser(actor, target) {
  if (!actor || !target) return false;
  if (isSuperAdmin(actor.rol)) return true;
  if (!isStaffAdmin(actor.rol)) return false;
  return target.rol === 'terapeuta';
}

function canViewUserList(actorRol) {
  return isStaffAdmin(actorRol);
}

function listFilterForRole(actorRol) {
  if (isSuperAdmin(actorRol)) return { sql: '', params: [] };
  if (isStaffAdmin(actorRol)) return { sql: " AND t.rol = 'terapeuta'", params: [] };
  return { sql: ' AND t.id = ?', params: [] };
}

module.exports = {
  ALL_ROLES,
  ROLE_LABELS,
  STAFF_ADMIN_ROLES,
  PRIVILEGED_ROLES,
  isSuperAdmin,
  isStaffAdmin,
  assignableRoles,
  canAssignRole,
  canManageUser,
  canViewUserList,
  listFilterForRole,
};
