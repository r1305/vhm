require('dotenv').config();
const jwt = require('jsonwebtoken');
const { siteEnv } = require('../lib/siteEnv');

let JWT_SECRET;
try {
  JWT_SECRET = siteEnv('JWT_SECRET');
} catch (_) {
  JWT_SECRET = process.env.JWT_SECRET;
}
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required in .env');
}

// Warn if JWT_SECRET is weak or predictable
const WEAK_SECRETS = ['change-me', 'secret', 'password', 'jwt_secret', 'vhm_libro_reclamaciones'];
const secretLower = String(JWT_SECRET).toLowerCase();
if (WEAK_SECRETS.some(w => secretLower.includes(w)) || String(JWT_SECRET).length < 32) {
  console.warn('[SECURITY] JWT_SECRET es débil o predecible. Genera uno fuerte con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
