const crypto = require('crypto');

function createCsrfMiddleware() {
  const CSRF_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

  function generateCsrfToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const sig = crypto.createHmac('sha256', CSRF_SECRET).update(token).digest('hex').slice(0, 16);
    return `${token}.${sig}`;
  }

  function validateCsrfToken(token) {
    if (!token || typeof token !== 'string') return false;
    const [val, sig] = token.split('.');
    if (!val || !sig) return false;
    const expected = crypto.createHmac('sha256', CSRF_SECRET).update(val).digest('hex').slice(0, 16);
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  }

  function csrfCookieOptions(basePath) {
    return { 
      httpOnly: false, 
      sameSite: 'strict', 
      path: basePath || '/', 
      secure: process.env.NODE_ENV === 'production' 
    };
  }

  return function csrfMiddleware(req, res, next) {
    const basePath = res.locals.basePath || '';
    
    if (req.method === 'GET') {
      const existing = req.cookies?.csrf_token;
      if (!existing || !validateCsrfToken(existing)) {
        res.cookie('csrf_token', generateCsrfToken(), csrfCookieOptions(basePath));
      }
    }
    
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      // Public paths that don't require CSRF
      const publicPostPaths = [
        '/api/auth/login', '/api/tribu-access/verificar',
        '/api/tribu-auth/login', '/api/tribu-auth/registro',
        '/api/tribu-auth/recuperar', '/api/tribu-auth/reset-password',
        '/api/tribu-auth/cambiar-password-temp',
        '/api/tribu-pagos/webhook', '/api/tribu-pagos/procesar-pago',
        '/api/tribu-pagos/cron-renovaciones',
        '/api/tribu-pagos/iniciar-prueba',
        '/api/tribu-auth/definir-contrasena',
      ];
      const isPublicEncuestaPost = req.method === 'POST' && /^\/api\/encuestas\/public\/[^/]+\/responder$/.test(req.path);
      const isPublicPost = req.method === 'POST' && publicPostPaths.some(p => req.path === p);
      const isPublicVideoAction = req.method === 'POST' && req.path.startsWith('/api/videos/') && (req.path.endsWith('/vista') || req.path.endsWith('/like'));
      const isTribuBearer = req.headers.authorization?.startsWith('Bearer ') &&
        (req.path.startsWith('/api/tribu-auth/') || req.path.startsWith('/api/tribu-pagos/') ||
         req.path.startsWith('/api/posts') || req.path.startsWith('/api/eventos'));
      
      if (!isPublicPost && !isPublicEncuestaPost && !isPublicVideoAction && !isTribuBearer) {
        const headerToken = req.headers['x-csrf-token'] || req.headers['csrf-token'];
        const cookieToken = req.cookies?.csrf_token;
        if (!validateCsrfToken(headerToken) || !validateCsrfToken(cookieToken) || headerToken !== cookieToken) {
          return res.status(403).json({ error: 'Token CSRF inválido' });
        }
      }
    }
    
    next();
  };
}

module.exports = { createCsrfMiddleware };