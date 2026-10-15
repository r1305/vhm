'use strict';
const crypto = require('crypto');
const env = require('./env');

const TTL_MS = 10 * 60 * 1000;

function secreto() {
  const base = env('OAUTH_STATE_SECRET') || env('JWT_SECRET') || env('SESSION_SECRET');
  if (!base) throw new Error('Falta OAUTH_STATE_SECRET, JWT_SECRET o SESSION_SECRET');
  return 'gcal-oauth-state:' + base;
}

const firmar = (body) => crypto.createHmac('sha256', secreto()).update(body).digest('base64url');

function crearState({ terapeutaId, userId, redirect }) {
  const body = Buffer.from(JSON.stringify({
    t: terapeutaId, u: userId, r: redirect,
    n: crypto.randomBytes(16).toString('hex'),
    e: Date.now() + TTL_MS,
  })).toString('base64url');
  return `${body}.${firmar(body)}`;
}

function verificarState(state) {
  if (typeof state !== 'string') return null;
  const i = state.indexOf('.');
  if (i < 1 || state.indexOf('.', i + 1) !== -1) return null;
  const body = state.slice(0, i);
  const sig = Buffer.from(state.slice(i + 1));
  const esperado = Buffer.from(firmar(body));
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(sig, esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isInteger(p.t) || !Number.isInteger(p.u) || !(p.e > Date.now())) return null;
    return { terapeutaId: p.t, userId: p.u, redirect: p.r };
  } catch { return null; }
}

function redirectInterno(v, def = 'terapeutas') {
  if (typeof v !== 'string') return def;
  const s = v.trim().replace(/^\//, '');
  if (!s || s.length > 100 || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(s)) return def;
  return s;
}

module.exports = { crearState, verificarState, redirectInterno };
