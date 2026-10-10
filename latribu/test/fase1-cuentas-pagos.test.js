const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function stubModule(absPath, exports) {
  const p = require.resolve(absPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports, children: [], paths: [] };
  return p;
}

stubModule(require.resolve('dotenv', { paths: [ROOT] }), { config: () => ({ parsed: {} }) });

for (const k of Object.keys(process.env)) {
  if (/^(SMTP_|DB_|CULQI_|TRIBU_|APP_SITE_PREFIX)/.test(k)) delete process.env[k];
}
process.env.NODE_ENV = 'test';
process.env.TZ = 'America/Lima';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.APP_MOUNT_PATH = '/latribu';
process.env.SITE_URL = 'https://example.test/latribu';
process.env.TRIBU_RENOVACION_CRON_SECRET = 'cron-secret-de-prueba-123';

class FakeDb {
  constructor() { this.reset(); }
  reset() { this.handlers = []; this.calls = []; this.released = 0; }
  on(re, fn) { this.handlers.push({ re, fn }); }
  async run(sql, params = []) {
    this.calls.push({ sql, params });
    for (const h of this.handlers) {
      if (h.re.test(sql)) {
        const r = await h.fn(params, sql);
        if (r !== undefined) return r;
      }
    }
    if (/^\s*(SELECT|SHOW)/i.test(sql)) return [[], []];
    return [{ affectedRows: 0, insertId: 0 }, []];
  }
  execute(sql, params) { return this.run(sql, params); }
  query(sql, params) { return this.run(sql, params); }
  async getConnection() {
    const db = this;
    return {
      execute: (s, p) => db.run(s, p),
      query: (s, p) => db.run(s, p),
      beginTransaction: async () => { db.calls.push({ sql: 'BEGIN', params: [] }); },
      commit: async () => { db.calls.push({ sql: 'COMMIT', params: [] }); },
      rollback: async () => { db.calls.push({ sql: 'ROLLBACK', params: [] }); },
      release: () => { db.released += 1; },
    };
  }
  sqls(re) { return this.calls.filter(c => re.test(c.sql)); }
}

const db = new FakeDb();
stubModule(path.join(ROOT, 'src/db.js'), db);
stubModule(path.join(ROOT, 'src/schema.js'), { ensureSchema: async () => {}, LANDING_INTRO_DEFAULT: '', LANDING_PACTO_DEFAULT: '' });

const mails = [];
let mailerConfigured = true;
stubModule(path.join(ROOT, 'lib/mailer.js'), {
  sendMail: async (m) => { mails.push(m); return { ok: true }; },
  isMailerConfigured: () => mailerConfigured,
  closeMailer: () => {},
});

const realFetch = global.fetch;
const culqiCalls = [];
let culqiHandler = null;
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.culqi.com/')) {
    culqiCalls.push({ url: u, opts });
    if (!culqiHandler) throw new Error('Llamada a Culqi no esperada: ' + u);
    return culqiHandler(u, opts);
  }
  if (u.startsWith('http://127.0.0.1:')) return realFetch(url, opts);
  throw new Error('fetch externo bloqueado en tests: ' + u);
};

const jwt = require(require.resolve('jsonwebtoken', { paths: [ROOT] }));
const app = require(path.join(ROOT, 'src/index.js'));
const renov = require(path.join(ROOT, 'src/tribuRenovaciones.js'));
const culqi = require(path.join(ROOT, 'src/tribuCulqi.js'));

let server;
let BASE;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });
test.beforeEach(() => {
  db.reset();
  mails.length = 0;
  culqiCalls.length = 0;
  culqiHandler = null;
  mailerConfigured = true;
  delete process.env.CULQI_WEBHOOK_SECRET;
  delete process.env.CULQI_WEBHOOK_AUTH;
  process.env.NODE_ENV = 'test';
});

let ipSeq = 10;
function nuevaIp() { ipSeq += 1; return `10.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`; }

async function post(p, body, headers = {}) {
  const res = await realFetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nuevaIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

function tokenTribu(id, email = 'test@example.test') {
  return jwt.sign({ id, email, tribu: true }, process.env.JWT_SECRET + '_tribu', { expiresIn: '1h' });
}

function sha256(v) { return crypto.createHash('sha256').update(v).digest('hex'); }

function chargeAprobado({ id = 'chr_test_abc123', amount = 3990, currency = 'PEN', ref = 'tribu-7-1-1700000000000' } = {}) {
  return {
    object: 'charge', id, amount, currency_code: currency, email: 'test@example.test',
    outcome: { type: 'venta_exitosa', code: 'AUT0000' },
    metadata: { external_reference: ref },
    source: { id: 'tkn_test_1', object: 'token' },
  };
}

function culqiConfigActiva() {
  db.on(/FROM config_culqi/, () => [[{ activo: 1, secret_key: 'sk_test_abc', public_key: 'pk_test_abc', modo: 'sandbox' }], []]);
}

test('recuperar: respuesta genérica, sin contraseña, token hasheado de 60 min', async () => {
  const usuarios = { 'test@example.test': { id: 7, nombre: 'Test', email: 'test@example.test' } };
  const estado = {};
  db.on(/SELECT id, nombre, email FROM tribu_users WHERE email = \?/, ([email]) => [[usuarios[email]].filter(Boolean), []]);
  db.on(/UPDATE tribu_users SET reset_token = \?, reset_token_exp = NOW\(\) \+ INTERVAL \? MINUTE/, ([hash, min, id]) => {
    estado[id] = { hash, min };
    return [{ affectedRows: 1 }, []];
  });

  const r1 = await post('/api/tribu-auth/recuperar', { email: 'test@example.test' });
  const r2 = await post('/api/tribu-auth/recuperar', { email: 'noexiste@example.test' });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.json, r2.json);
  assert.ok(!/temp|password/i.test(Object.keys(r1.json).join(',')));
  assert.ok(!('tempPassword' in r1.json));

  await new Promise(r => setTimeout(r, 20));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'test@example.test');
  const token = /token=([a-f0-9]{64})/.exec(mails[0].text)[1];
  assert.equal(estado[7].hash, sha256(token));
  assert.notEqual(estado[7].hash, token);
  assert.equal(estado[7].min, 60);
  assert.equal(db.sqls(/password_plain/).length, 0);
});

test('reset-password: token de un solo uso y que caduca', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  const user = { id: 7, hash: sha256(token), exp: Date.now() + 60 * 60 * 1000 };
  db.on(/SELECT id FROM tribu_users WHERE reset_token = \? AND reset_token_exp > NOW\(\)/, ([h]) =>
    [user.hash && h === user.hash && Date.now() < user.exp ? [{ id: user.id }] : [], []]);
  db.on(/UPDATE tribu_users SET password = \?, psw_temp = 0, email_verificado = 1, reset_token = NULL/, ([, id, h]) => {
    if (id === user.id && h === user.hash && Date.now() < user.exp) { user.hash = null; return [{ affectedRows: 1 }, []]; }
    return [{ affectedRows: 0 }, []];
  });

  const ok = await post('/api/tribu-auth/reset-password', { token, password: 'nuevaClave123' });
  assert.equal(ok.status, 200);
  const again = await post('/api/tribu-auth/reset-password', { token, password: 'otraClave123' });
  assert.equal(again.status, 400);

  const token2 = crypto.randomBytes(32).toString('hex');
  user.hash = sha256(token2);
  user.exp = Date.now() - 1000;
  const vencido = await post('/api/tribu-auth/reset-password', { token: token2, password: 'nuevaClave123' });
  assert.equal(vencido.status, 400);

  const basura = await post('/api/tribu-auth/reset-password', { token: 'abc', password: 'nuevaClave123' });
  assert.equal(basura.status, 400);
});

test('registro: email existente responde igual que uno nuevo (con SMTP) y no emite sesión', async () => {
  db.on(/SELECT id, nombre FROM tribu_users WHERE email = \?/, ([email]) =>
    [email === 'test@example.test' ? [{ id: 7, nombre: 'Test' }] : [], []]);
  db.on(/INSERT INTO tribu_users/, () => [{ affectedRows: 1, insertId: 99 }, []]);
  const existente = await post('/api/tribu-auth/registro', { nombre: 'A', apellido: 'B', email: 'test@example.test', password: 'clave123' });
  const nuevo = await post('/api/tribu-auth/registro', { nombre: 'A', apellido: 'B', email: 'nuevo@example.test', password: 'clave123' });
  assert.equal(existente.status, 202);
  assert.equal(nuevo.status, 202);
  assert.deepEqual(existente.json, nuevo.json);
  assert.ok(!existente.json.token && !nuevo.json.token);
  const insert = db.sqls(/INSERT INTO tribu_users/);
  assert.equal(insert.length, 1);
  assert.equal(insert[0].params[4], 0);
});

test('iniciar-prueba con email existente: 409 sin sesión, sin cambios y sin llamar a Culqi', async () => {
  culqiConfigActiva();
  db.on(/SELECT id FROM tribu_users WHERE email = \?/, () => [[{ id: 7 }], []]);
  const r = await post('/api/tribu-pagos/iniciar-prueba', {
    nombre: 'Test Prueba', email: 'test@example.test', terms_accepted: true, token_id: 'tkn_test_1',
  });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'cuenta_existente');
  assert.ok(!r.json.token);
  assert.equal(db.sqls(/^\s*(UPDATE|INSERT|DELETE)/i).length, 0);
  assert.equal(culqiCalls.length, 0);
});

test('webhook falso (cargo inexistente en Culqi) no activa nada', async () => {
  culqiConfigActiva();
  culqiHandler = () => jsonResponse(404, { object: 'error', merchant_message: 'No encontrado' });
  const r = await post('/api/tribu-pagos/webhook', {
    object: 'event', type: 'charge.creation.succeeded',
    data: JSON.stringify(chargeAprobado({ id: 'chr_test_falso1' })),
  });
  assert.equal(r.status, 200);
  assert.equal(culqiCalls.length, 1);
  assert.match(culqiCalls[0].url, /\/charges\/chr_test_falso1$/);
  assert.equal(db.sqls(/INSERT INTO tribu_suscripciones|INSERT INTO tribu_culqi_payment_events/).length, 0);
});

test('webhook confía solo en Culqi: payload con datos inventados se ignora si Culqi dice otra cosa', async () => {
  culqiConfigActiva();
  db.on(/SELECT id, precio, vigencia_dias FROM suscripciones WHERE id = \?/, () => [[{ id: 1, precio: '39.90', vigencia_dias: 30 }], []]);
  culqiHandler = () => jsonResponse(200, chargeAprobado({ amount: 100 }));
  const r = await post('/api/tribu-pagos/webhook', {
    type: 'charge.creation.succeeded', data: chargeAprobado({ amount: 3990 }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.sqls(/INSERT INTO tribu_suscripciones/).length, 0);
});

test('webhook con monto o moneda distintos al plan: rechazado', async () => {
  culqiConfigActiva();
  db.on(/SELECT id, precio, vigencia_dias FROM suscripciones WHERE id = \?/, () => [[{ id: 1, precio: '39.90', vigencia_dias: 30 }], []]);
  culqiHandler = () => jsonResponse(200, chargeAprobado({ amount: 1000 }));
  await post('/api/tribu-pagos/webhook', { type: 'charge.creation.succeeded', data: { id: 'chr_test_abc123' } });
  culqiHandler = () => jsonResponse(200, chargeAprobado({ currency: 'USD' }));
  await post('/api/tribu-pagos/webhook', { type: 'charge.creation.succeeded', data: { id: 'chr_test_abc123' } });
  culqiHandler = () => jsonResponse(200, chargeAprobado({ ref: 'otra-tienda-1' }));
  await post('/api/tribu-pagos/webhook', { type: 'charge.creation.succeeded', data: { id: 'chr_test_abc123' } });
  assert.equal(culqiCalls.length, 3);
  assert.equal(db.sqls(/INSERT INTO tribu_suscripciones|INSERT INTO tribu_culqi_payment_events/).length, 0);
});

test('webhook con cargo real (simulado) activa la suscripción una sola vez', async () => {
  culqiConfigActiva();
  const eventos = new Set();
  db.on(/SELECT id, precio, vigencia_dias FROM suscripciones WHERE id = \?/, () => [[{ id: 1, precio: '39.90', vigencia_dias: 30 }], []]);
  db.on(/SELECT culqi_charge_id FROM tribu_culqi_payment_events WHERE culqi_charge_id = \?/, ([id]) => [eventos.has(id) ? [{ culqi_charge_id: id }] : [], []]);
  db.on(/INSERT INTO tribu_culqi_payment_events/, ([id]) => {
    if (eventos.has(id)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
    eventos.add(id);
    return [{ affectedRows: 1 }, []];
  });
  db.on(/INSERT INTO tribu_suscripciones/, () => [{ affectedRows: 1, insertId: 501 }, []]);
  culqiHandler = () => jsonResponse(200, chargeAprobado());
  const body = { type: 'charge.creation.succeeded', data: JSON.stringify({ id: 'chr_test_abc123' }) };
  const r1 = await post('/api/tribu-pagos/webhook', body);
  const r2 = await post('/api/tribu-pagos/webhook', body);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(db.sqls(/INSERT INTO tribu_suscripciones/).length, 1);
  assert.ok(db.sqls(/UPDATE tribu_suscripciones SET auto_renovacion = 0 WHERE tribu_user_id = \? AND activo = 1/).length >= 1);
  const iTx = db.calls.findIndex(c => /INSERT INTO tribu_culqi_transactions/.test(c.sql));
  const iSub = db.calls.findIndex(c => /INSERT INTO tribu_suscripciones/.test(c.sql));
  assert.ok(iTx >= 0 && iTx < iSub, 'la transacción se registra antes de activar');
});

test('webhook: 503 en producción sin secreto y 401 con firma inválida', async () => {
  process.env.NODE_ENV = 'production';
  const r = await post('/api/tribu-pagos/webhook', { type: 'charge.creation.succeeded', data: { id: 'chr_test_abc123' } });
  assert.equal(r.status, 503);
  process.env.CULQI_WEBHOOK_SECRET = 'whsec_prueba';
  const raw = JSON.stringify({ type: 'charge.creation.succeeded', data: { id: 'chr_test_abc123' } });
  const bad = await post('/api/tribu-pagos/webhook', raw, { 'x-culqi-signature': 'deadbeef' });
  assert.equal(bad.status, 401);
  culqiConfigActiva();
  culqiHandler = () => jsonResponse(404, {});
  const sig = crypto.createHmac('sha256', 'whsec_prueba').update(raw).digest('hex');
  const good = await post('/api/tribu-pagos/webhook', raw, { 'x-culqi-signature': sig });
  assert.equal(good.status, 200);
  assert.equal(culqiCalls.length, 1);
});

test('parseWebhookEvent acepta data string u objeto y eventos reales de Culqi', () => {
  const a = culqi.parseWebhookEvent({ type: 'charge.creation.succeeded', data: '{"id":"chr_live_X1y2"}' });
  assert.deepEqual([a.isChargeSuccess, a.chargeId], [true, 'chr_live_X1y2']);
  const b = culqi.parseWebhookEvent({ type: 'charge.succeeded', data: { id: 'chr_test_abcd' } });
  assert.equal(b.isChargeSuccess, true);
  const c = culqi.parseWebhookEvent({ type: 'charge.creation.failed', data: { id: 'chr_test_abcd' } });
  assert.equal(c.isChargeSuccess, false);
  const d = culqi.parseWebhookEvent({ type: 'charge.creation.succeeded', data: { id: '../customers' } });
  assert.equal(d.chargeId, null);
});

function filaRenovacion(extra = {}) {
  return {
    id: 33, tribu_user_id: 7, suscripcion_id: 1, culqi_customer_id: 'cus_test_1', culqi_card_id: 'crd_test_1',
    renovacion_intentos: 0, fecha_fin: new Date('2026-10-09T05:00:00Z'), plan_nombre: 'Plan Base', precio: '39.90',
    vigencia_dias: 30, email: 'test@example.test', nombre: 'Test', apellido: 'Tribu', telefono: null, ...extra,
  };
}

test('fallo de BD tras cobro aprobado: pendiente_conciliar y sin markRenewalFailed', async () => {
  db.on(/UPDATE tribu_suscripciones\s+SET fecha_fin = DATE_ADD/, () => { throw new Error('BD caída'); });
  culqiHandler = (u, opts) => {
    assert.equal(opts.method, 'POST');
    return jsonResponse(200, chargeAprobado({ id: 'chr_test_ren1', ref: 'tribu-renew-33-1700000000000' }));
  };
  const r = await renov.procesarRenovacionSuscripcion(filaRenovacion(), { secret_key: 'sk_test_abc' });
  assert.equal(r.pendiente_conciliar, true);
  assert.equal(db.sqls(/SET pendiente_conciliar = 1/).length, 1);
  assert.equal(db.sqls(/INTERVAL 1 DAY/).length, 0, 'no se llama a markRenewalFailed');
  const iTx = db.calls.findIndex(c => /INSERT INTO tribu_culqi_transactions/.test(c.sql));
  const iExt = db.calls.findIndex(c => /SET fecha_fin = DATE_ADD/.test(c.sql));
  assert.ok(iTx >= 0 && iTx < iExt);
  assert.ok(db.sqls(/ROLLBACK/).length >= 1);
  assert.equal(culqiCalls[0].opts.headers['X-Idempotency-Key'], 'ren_33_20261009_1');
});

test('renovación con transacción aprobada reciente: no cobra', async () => {
  db.on(/FROM tribu_culqi_transactions\s+WHERE external_reference LIKE \?/, ([like]) => {
    assert.equal(like, 'tribu-renew-33-%');
    return [[{ culqi_charge_id: 'chr_test_prev' }], []];
  });
  const r = await renov.procesarRenovacionSuscripcion(filaRenovacion(), { secret_key: 'sk_test_abc' });
  assert.equal(r.skipped, 'cobro_reciente');
  assert.equal(culqiCalls.length, 0);
});

test('timeout de Culqi en renovación: resultado desconocido, sin fallo contado y lock liberado', async () => {
  culqiConfigActiva();
  let lockLiberado = false;
  db.on(/SELECT GET_LOCK/, () => [[{ obtenido: 1 }], []]);
  db.on(/SELECT RELEASE_LOCK/, () => { lockLiberado = true; return [[{ liberado: 1 }], []]; });
  db.on(/FROM tribu_suscripciones ts\s+JOIN suscripciones s/, () => [[filaRenovacion()], []]);
  db.on(/SET renovacion_intentos = renovacion_intentos \+ 1/, () => [{ affectedRows: 1 }, []]);
  culqiHandler = (u, opts) => {
    assert.ok(opts.signal instanceof AbortSignal, 'la llamada a Culqi lleva timeout');
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const r = await renov.runRenovacionesSuscripciones();
  assert.equal(r.results[0].unknown, true);
  assert.ok(lockLiberado);
  assert.equal(db.released, 1);
  assert.equal(db.sqls(/GREATEST\(renovacion_intentos - 1, 0\)/).length, 1);
  assert.equal(db.sqls(/INTERVAL 1 DAY/).length, 0);
  assert.ok(db.sqls(/SET renovando = 0, renovando_hasta = NULL, worker_pid = NULL WHERE id = \?/).length >= 1);
});

test('timeout de Culqi en el cron HTTP: libera GET_LOCK y la conexión', async () => {
  culqiConfigActiva();
  let lockLiberado = false;
  db.on(/SELECT GET_LOCK/, () => [[{ obtenido: 1 }], []]);
  db.on(/SELECT RELEASE_LOCK/, () => { lockLiberado = true; return [[{ liberado: 1 }], []]; });
  db.on(/FROM tribu_suscripciones ts\s+JOIN suscripciones s/, () => [[filaRenovacion()], []]);
  db.on(/SET renovacion_intentos = renovacion_intentos \+ 1/, () => [{ affectedRows: 1 }, []]);
  culqiHandler = () => { throw new DOMException('timeout', 'TimeoutError'); };
  const conQuery = await realFetch(`${BASE}/api/tribu-pagos/cron-renovaciones?token=${process.env.TRIBU_RENOVACION_CRON_SECRET}`);
  assert.equal(conQuery.status, 401);
  const res = await realFetch(`${BASE}/api/tribu-pagos/cron-renovaciones`, { headers: { 'X-Cron-Token': process.env.TRIBU_RENOVACION_CRON_SECRET } });
  assert.equal(res.status, 200);
  assert.ok(lockLiberado);
  assert.equal(db.released, 1);
});

function prepararPago({ estadoTx }) {
  culqiConfigActiva();
  db.on(/SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = \?/, () => [[{ id: 1, nombre: 'Plan Base', precio: '39.90', vigencia_dias: 30 }], []]);
  db.on(/SELECT email_verificado FROM tribu_users/, () => [[{ email_verificado: 1 }], []]);
  db.on(/FROM tribu_culqi_transactions\s+WHERE tribu_user_id = \? AND suscripcion_plan_id = \?/, () => [estadoTx.aprobada ? [{ culqi_charge_id: 'chr_test_pay' }] : [], []]);
  db.on(/INSERT INTO tribu_culqi_transactions/, (p) => { if (p[6] === 'approved') estadoTx.aprobada = true; return [{ affectedRows: 1 }, []]; });
  db.on(/INSERT INTO tribu_suscripciones/, () => [{ affectedRows: 1, insertId: 601 }, []]);
  db.on(/INSERT INTO tribu_culqi_payment_events/, () => [{ affectedRows: 1 }, []]);
}

test('doble procesar-pago con el mismo request_id: un solo cargo', async () => {
  const estadoTx = { aprobada: false };
  prepararPago({ estadoTx });
  culqiHandler = async (u, opts) => {
    if (/\/charges$/.test(u)) {
      await new Promise(r => setTimeout(r, 50));
      return jsonResponse(200, chargeAprobado({ id: 'chr_test_pay', ref: 'tribu-41-1-1' }));
    }
    throw new Error('inesperado ' + u);
  };
  const token = tokenTribu(41);
  const rid = crypto.randomUUID();
  const body = { suscripcion_id: 1, token_id: 'tkn_test_1', auto_renovacion: false, request_id: rid };
  const h = { Authorization: 'Bearer ' + token };
  const [a, b] = await Promise.all([post('/api/tribu-pagos/procesar-pago', body, h), post('/api/tribu-pagos/procesar-pago', body, h)]);
  const c = await post('/api/tribu-pagos/procesar-pago', body, h);
  const charges = culqiCalls.filter(x => /\/charges$/.test(x.url));
  assert.equal(charges.length, 1);
  assert.equal(charges[0].opts.headers['X-Idempotency-Key'], `pay_41_${rid}`);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(c.status, 409);
  assert.equal(c.json.code, 'pago_reciente');
  assert.equal(db.sqls(/INSERT INTO tribu_suscripciones/).length, 1);
});

test('procesar-pago: timeout de Culqi responde 504 sin activar', async () => {
  prepararPago({ estadoTx: { aprobada: false } });
  culqiHandler = () => { throw new DOMException('timeout', 'TimeoutError'); };
  const r = await post('/api/tribu-pagos/procesar-pago',
    { suscripcion_id: 1, token_id: 'tkn_test_1', auto_renovacion: false, request_id: crypto.randomUUID() },
    { Authorization: 'Bearer ' + tokenTribu(42) });
  assert.equal(r.status, 504);
  assert.equal(r.json.code, 'resultado_desconocido');
  assert.equal(db.sqls(/INSERT INTO tribu_suscripciones/).length, 0);
});

test('procesar-pago: usuario con email sin verificar no puede pagar', async () => {
  culqiConfigActiva();
  db.on(/SELECT id, nombre, precio, vigencia_dias FROM suscripciones WHERE id = \?/, () => [[{ id: 1, nombre: 'Plan Base', precio: '39.90', vigencia_dias: 30 }], []]);
  db.on(/SELECT email_verificado FROM tribu_users/, () => [[{ email_verificado: 0 }], []]);
  const r = await post('/api/tribu-pagos/procesar-pago', { suscripcion_id: 1, token_id: 'tkn_test_1' }, { Authorization: 'Bearer ' + tokenTribu(43) });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'email_no_verificado');
  assert.equal(culqiCalls.length, 0);
});

test('activateNewSubscription: API y webhook a la vez dejan una sola fila activa', async () => {
  const eventos = new Set();
  db.on(/INSERT INTO tribu_culqi_payment_events/, async ([id]) => {
    await new Promise(r => setTimeout(r, 5));
    if (eventos.has(id)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
    eventos.add(id);
    return [{ affectedRows: 1 }, []];
  });
  db.on(/SELECT MAX\(fecha_fin\) AS fin/, () => [[{ fin: new Date('2026-10-20T05:00:00Z') }], []]);
  db.on(/INSERT INTO tribu_suscripciones/, () => [{ affectedRows: 1, insertId: 700 }, []]);
  db.on(/SELECT id FROM tribu_suscripciones WHERE culqi_charge_id = \?/, () => [[{ id: 700 }], []]);
  const args = { userId: 7, planId: 1, chargeId: 'chr_test_par', vigenciaDias: 30 };
  const [x, y] = await Promise.all([renov.activateNewSubscription(args), renov.activateNewSubscription(args)]);
  assert.equal(x, 700);
  assert.equal(y, 700);
  const inserts = db.sqls(/INSERT INTO tribu_suscripciones/);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[2], '2026-10-20', 'extiende desde la fecha_fin vigente');
});

test('lecturas de acceso no modifican tribu_suscripciones', async () => {
  db.on(/FROM tribu_users WHERE id = \? LIMIT 1/, () => [[{ id: 7, nombre: 'T', apellido: 'T', email: 'test@example.test', psw_temp: 0, is_suscribed: 1, email_verificado: 1 }], []]);
  const res = await realFetch(`${BASE}/api/tribu-auth/me`, { headers: { Authorization: 'Bearer ' + tokenTribu(7) } });
  assert.equal(res.status, 200);
  assert.equal(db.sqls(/UPDATE tribu_suscripciones/).length, 0);
  const acceso = db.sqls(/COUNT\(\*\) AS total FROM tribu_suscripciones/);
  assert.ok(acceso.length >= 1);
  assert.match(acceso[0].sql, /renovacion_intentos < 4/);
  assert.match(acceso[0].sql, /INTERVAL 3 DAY/);
});

test('rate limits en memoria', async () => {
  culqiConfigActiva();
  db.on(/SELECT id FROM tribu_users WHERE email = \?/, () => [[{ id: 7 }], []]);
  const ip = '10.200.0.1';
  const prueba = (email) => post('/api/tribu-pagos/iniciar-prueba',
    { nombre: 'X', email, terms_accepted: true, token_id: 'tkn' }, { 'X-Forwarded-For': ip });
  const sts = [];
  for (let i = 0; i < 4; i++) sts.push((await prueba(`rl${i}@example.test`)).status);
  assert.deepEqual(sts, [409, 409, 409, 429]);

  const porEmail = [];
  for (let i = 0; i < 4; i++) {
    porEmail.push((await post('/api/tribu-pagos/iniciar-prueba',
      { nombre: 'X', email: 'mismo@example.test', terms_accepted: true, token_id: 'tkn' })).status);
  }
  assert.deepEqual(porEmail, [409, 409, 409, 429]);

  const reg = [];
  for (let i = 0; i < 6; i++) {
    reg.push((await post('/api/tribu-auth/registro',
      { nombre: 'A', apellido: 'B', email: `r${i}@example.test`, password: 'clave123' }, { 'X-Forwarded-For': '10.200.0.2' })).status);
  }
  assert.equal(reg[5], 429);

  mails.length = 0;
  db.on(/SELECT id, nombre, email FROM tribu_users WHERE email = \?/, () => [[{ id: 8, nombre: 'R', email: 'rec@example.test' }], []]);
  const rec = [];
  for (let i = 0; i < 4; i++) rec.push(await post('/api/tribu-auth/recuperar', { email: 'rec@example.test' }));
  assert.deepEqual(rec.map(r => r.status), [200, 200, 200, 200]);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(mails.length, 3);

  const token = tokenTribu(44);
  const pagos = [];
  for (let i = 0; i < 11; i++) {
    pagos.push((await post('/api/tribu-pagos/procesar-pago', {}, { Authorization: 'Bearer ' + token })).status);
  }
  assert.equal(pagos[9], 400);
  assert.equal(pagos[10], 429);
});

test('crearLimitador limpia por ventana', () => {
  const { crearLimitador } = require(path.join(ROOT, 'src/lib/rateLimitMemoria.js'));
  const lim = crearLimitador({ max: 2, ventanaMs: 30 });
  assert.equal(lim.consumir('k').ok, true);
  assert.equal(lim.consumir('k').ok, true);
  assert.equal(lim.consumir('k').ok, false);
  lim._registros.get('k').inicio -= 100;
  assert.equal(lim.consumir('k').ok, true);
});

test('asegurarIndiceUnico no crea el índice si hay duplicados', async () => {
  const schemaPath = require.resolve(path.join(ROOT, 'src/schema.js'));
  const stub = require.cache[schemaPath];
  delete require.cache[schemaPath];
  const { asegurarIndiceUnico } = require(schemaPath);
  require.cache[schemaPath] = stub;
  db.on(/SHOW INDEX FROM/, () => [[], []]);
  db.on(/GROUP BY `email` HAVING COUNT/, () => [[{ valor: 'a@b.c', total: 2 }], []]);
  const ok = await asegurarIndiceUnico('tribu_users', 'uq_tribu_users_email', 'email');
  assert.equal(ok, false);
  assert.equal(db.sqls(/ADD UNIQUE KEY/).length, 0);
  db.reset();
  db.on(/SHOW INDEX FROM/, () => [[], []]);
  const ok2 = await asegurarIndiceUnico('tribu_suscripciones', 'uq_ts_culqi_charge', 'culqi_charge_id');
  assert.equal(ok2, true);
  assert.equal(db.sqls(/ADD UNIQUE KEY `uq_ts_culqi_charge`/).length, 1);
});

test('DELETE de plan con suscripciones responde 409', async () => {
  const adminToken = jwt.sign({ id: 1, rol: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  db.on(/SELECT COUNT\(\*\) AS total FROM tribu_suscripciones WHERE suscripcion_id = \?/, () => [[{ total: 3 }], []]);
  const csrf = await realFetch(`${BASE}/health`);
  const cookie = (csrf.headers.get('set-cookie') || '').split(';')[0];
  const csrfToken = decodeURIComponent(cookie.split('=')[1] || '');
  const res = await realFetch(`${BASE}/api/suscripciones/1`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + adminToken, Cookie: cookie, 'X-CSRF-Token': csrfToken },
  });
  assert.equal(res.status, 409);
  assert.equal(db.sqls(/DELETE FROM suscripciones/).length, 0);
});
