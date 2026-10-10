const limitadores = new Set();
let limpiezaTimer = null;

function limpiar() {
  const ahora = Date.now();
  for (const lim of limitadores) {
    for (const [k, r] of lim.registros) if (ahora - r.inicio > lim.ventanaMs) lim.registros.delete(k);
  }
}

function asegurarLimpieza() {
  if (limpiezaTimer) return;
  limpiezaTimer = setInterval(limpiar, 10 * 60 * 1000);
  if (typeof limpiezaTimer.unref === 'function') limpiezaTimer.unref();
}

function detenerLimpieza() {
  if (limpiezaTimer) { clearInterval(limpiezaTimer); limpiezaTimer = null; }
}

function crearLimitador({ max, ventanaMs }) {
  const lim = { max, ventanaMs, registros: new Map() };
  limitadores.add(lim);
  asegurarLimpieza();
  return {
    consumir(clave) {
      const k = String(clave || '');
      const ahora = Date.now();
      let r = lim.registros.get(k);
      if (!r || ahora - r.inicio > ventanaMs) {
        r = { inicio: ahora, count: 0 };
        lim.registros.set(k, r);
      }
      r.count += 1;
      if (r.count > max) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((ventanaMs - (ahora - r.inicio)) / 1000)) };
      }
      return { ok: true, retryAfterSec: 0 };
    },
    reset(clave) { lim.registros.delete(String(clave || '')); },
    _registros: lim.registros,
  };
}

function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function responder429(res, r, mensaje) {
  const min = Math.max(1, Math.ceil(r.retryAfterSec / 60));
  res.set('Retry-After', String(r.retryAfterSec));
  return res.status(429).json({ error: mensaje || `Demasiados intentos. Intenta en ${min} minuto(s).` });
}

module.exports = { crearLimitador, ipDe, responder429, detenerLimpieza };
