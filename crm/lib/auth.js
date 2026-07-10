const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[crm/auth] ⚠️ JWT_SECRET no configurado — usando fallback inseguro. Define JWT_SECRET en .env');
  return 'crm_dev_secret_change_me';
})();

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '10h' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Solo superadmin o recepcion pueden ver todos los pacientes
function authAdmin(req, res, next) {
  auth(req, res, () => {
    if (!['superadmin', 'recepcion'].includes(req.user.rol)) {
      return res.status(403).json({ error: 'Acceso restringido' });
    }
    next();
  });
}

// Filtra registros por terapeuta_id salvo superadmin/recepcion
function ownerFilter(req, alias = '') {
  if (['superadmin', 'recepcion'].includes(req.user?.rol)) return { sql: '', params: [] };
  const col = alias ? `${alias}.terapeuta_id` : 'terapeuta_id';
  return { sql: ` AND ${col} = ?`, params: [req.user.id] };
}

module.exports = { signToken, auth, authAdmin, ownerFilter };
