const env = require('./env');
const jwt = require('jsonwebtoken');

const JWT_SECRET = env('JWT_SECRET');
if (!JWT_SECRET) throw new Error('JWT_SECRET is required in luma/.env');

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
