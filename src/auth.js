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
