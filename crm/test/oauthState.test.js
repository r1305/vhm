const test = require('node:test');
const assert = require('node:assert');

const CLAVE = 'CRM_OAUTH_STATE_SECRET';
const previo = process.env[CLAVE];
process.env[CLAVE] = 'secreto-de-prueba';
test.after(() => {
  if (previo === undefined) delete process.env[CLAVE];
  else process.env[CLAVE] = previo;
});

const { crearState, verificarState, redirectInterno } = require('../lib/oauthState');

const datos = { terapeutaId: 7, userId: 42, redirect: 'calendario' };

test('state valido se verifica y devuelve los datos', () => {
  assert.deepStrictEqual(verificarState(crearState(datos)), datos);
});

test('firma alterada devuelve null', () => {
  const [body, sig] = crearState(datos).split('.');
  const mala = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.strictEqual(verificarState(`${body}.${mala}`), null);
});

test('payload alterado devuelve null', () => {
  const [body, sig] = crearState(datos).split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  p.t = 999;
  const nuevo = Buffer.from(JSON.stringify(p)).toString('base64url');
  assert.strictEqual(verificarState(`${nuevo}.${sig}`), null);
});

test('formato invalido devuelve null', () => {
  assert.strictEqual(verificarState('sinpunto'), null);
  assert.strictEqual(verificarState('a.b.c'), null);
  assert.strictEqual(verificarState('.firma'), null);
  for (const v of [undefined, null, 123, {}, []]) assert.strictEqual(verificarState(v), null);
});

test('state expirado devuelve null', (t) => {
  const state = crearState(datos);
  assert.notStrictEqual(verificarState(state), null);
  const ahora = Date.now();
  t.mock.method(Date, 'now', () => ahora + 10 * 60 * 1000 + 1);
  assert.strictEqual(verificarState(state), null);
});

test('redirectInterno rechaza rutas peligrosas', () => {
  for (const v of ['//evil.com', '/evil.com', 'https:x', '..', 'a/../b', 'a\\b', 'a//b']) {
    assert.strictEqual(redirectInterno(v), 'terapeutas', v);
  }
});

test('redirectInterno acepta rutas internas', () => {
  assert.strictEqual(redirectInterno('calendario'), 'calendario');
  assert.strictEqual(redirectInterno('ok-1/sub'), 'ok-1/sub');
});
