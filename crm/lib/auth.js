const jwt = require('jsonwebtoken');
const { isStaffAdmin, isSuperAdmin } = require('./roles');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET is not defined in production environment');
  } else {
    console.warn('[crm/auth] ⚠️ JWT_SECRET no configurado — usando fallback inseguro para desarrollo. Define JWT_SECRET en .env');
    process.env.JWT_SECRET = 'crm_dev_secret_change_me';
  }
}
const FINAL_SECRET = process.env.JWT_SECRET;

// TODO(A4): el JWT viaja en el header Authorization (Bearer) y no en cookie.
// La cookie de sesión ya es httpOnly (app.js), pero si algún día se sirve el
// JWT en cookie hay que configurarla httpOnly + secure (COOKIE_SECURE) + sameSite.
// Mantener expiresIn por debajo de 24h; nunca 'never'.
function signToken(payload) {
  return jwt.sign(payload, FINAL_SECRET, { expiresIn: '10h' });
}

function auth(req, res, next) {
  if (req.session?.user) {
    req.user = req.session.user;
    return next();
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, FINAL_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function authAdmin(req, res, next) {
  auth(req, res, () => {
    if (!isStaffAdmin(req.user.rol)) {
      return res.status(403).json({ error: 'Acceso restringido' });
    }
    next();
  });
}

function authSuperAdmin(req, res, next) {
  auth(req, res, () => {
    if (!isSuperAdmin(req.user.rol)) {
      return res.status(403).json({ error: 'Solo superadmin' });
    }
    next();
  });
}

function ownerFilter(req, alias = '') {
  if (isStaffAdmin(req.user?.rol)) return { sql: '', params: [] };
  const col = alias ? `${alias}.terapeuta_id` : 'terapeuta_id';
  return { sql: ` AND ${col} = ?`, params: [req.user.id] };
}

module.exports = { signToken, auth, authAdmin, authSuperAdmin, ownerFilter };
