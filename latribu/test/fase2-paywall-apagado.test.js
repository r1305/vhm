const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

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

class FakeDb {
  constructor() { this.reset(); }
  reset() { this.handlers = []; this.calls = []; }
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
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    };
  }
  async end() { this.cerrado = true; }
  sqls(re) { return this.calls.filter(c => re.test(c.sql)); }
}

const db = new FakeDb();
stubModule(path.join(ROOT, 'src/db.js'), db);
stubModule(path.join(ROOT, 'src/schema.js'), { ensureSchema: async () => {}, LANDING_INTRO_DEFAULT: '', LANDING_PACTO_DEFAULT: '' });
stubModule(path.join(ROOT, 'lib/mailer.js'), {
  sendMail: async () => ({ ok: true }),
  isMailerConfigured: () => false,
  closeMailer: () => {},
});

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1:')) return realFetch(url, opts);
  throw new Error('fetch externo bloqueado en tests: ' + u);
};

const jwt = require(require.resolve('jsonwebtoken', { paths: [ROOT] }));
const sigtermAntes = process.listenerCount('SIGTERM');
const sigintAntes = process.listenerCount('SIGINT');
const shell = require(path.join(ROOT, 'app.js'));
const app = require(path.join(ROOT, 'src/index.js'));
const { buildEventIcs } = require(path.join(ROOT, 'lib/tribuEventoIcs.js'));
const { toYmdLima } = require(path.join(ROOT, 'lib/validation.js'));
const { crearGracefulShutdown, registrarSenales } = require(path.join(ROOT, 'src/lib/apagado.js'));

let server;
let BASE;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });
test.beforeEach(() => { db.reset(); });

let ipSeq = 10;
function nuevaIp() { ipSeq += 1; return `10.2.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`; }

async function http(method, p, { body, headers = {}, ip } = {}) {
  const opts = { method, headers: { 'X-Forwarded-For': ip || nuevaIp(), ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await realFetch(BASE + p, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text, headers: res.headers };
}

function tokenTribu(id) {
  return jwt.sign({ id, email: 'test@example.test', tribu: true }, process.env.JWT_SECRET + '_tribu', { expiresIn: '1h' });
}
function tokenAdmin(id, rol) {
  return jwt.sign({ id, username: 'admin', rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
function bearer(t) { return { Authorization: 'Bearer ' + t }; }

function conSuscripcion(activa) {
  db.on(/FROM tribu_suscripciones ts\s+WHERE ts\.tribu_user_id = \?/, () => [[{ total: activa ? 1 : 0 }], []]);
}

async function csrf() {
  const r = await realFetch(`${BASE}/health`);
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { Cookie: cookie, 'X-CSRF-Token': decodeURIComponent(cookie.split('=')[1] || '') };
}

test('listado público de videos no incluye video_url', async () => {
  db.on(/FROM videos v\s+LEFT JOIN video_categorias c ON c.id = v.categoria_id\s+WHERE v.activo = 1/, () =>
    [[{ id: 1, titulo: 'Uno', thumbnail_url: null, vistas: 0, likes: 0 }], []]);
  const r = await http('GET', '/api/videos');
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 1);
  assert.ok(!('video_url' in r.json[0]));
  const sel = db.sqls(/FROM videos v\s+LEFT JOIN/)[0];
  assert.ok(sel && !/video_url/.test(sel.sql));
  const cats = await http('GET', '/api/videos/categorias');
  assert.equal(cats.status, 200);
  assert.ok(!/video_url/.test(cats.text));
});

test('listado público de eventos no incluye ubicacion', async () => {
  db.on(/FROM tribu_eventos WHERE activo = 1/, () =>
    [[{ id: 3, nombre: 'Círculo', fecha: '2026-10-20', hora_inicio: '19:00:00', lugar: 'Zoom', ubicacion: 'https://zoom.example/secreto', tiene_enlace: 1 }], []]);
  const r = await http('GET', '/api/eventos');
  assert.equal(r.status, 200);
  assert.ok(!('ubicacion' in r.json[0]));
  assert.equal(r.json[0].tiene_enlace, true);
  assert.ok(!/zoom\.example/.test(r.text));
});

test('GET /api/videos/:id/reproducir: 401 sin token, 403 sin suscripción, URL con suscripción', async () => {
  db.on(/SELECT id, video_url FROM videos WHERE id = \?/, () => [[{ id: 5, video_url: 'https://www.loom.com/share/abc' }], []]);
  const sinToken = await http('GET', '/api/videos/5/reproducir');
  assert.equal(sinToken.status, 401);

  conSuscripcion(false);
  const sinSus = await http('GET', '/api/videos/5/reproducir', { headers: bearer(tokenTribu(7)) });
  assert.equal(sinSus.status, 403);
  assert.ok(!/loom/.test(sinSus.text));

  db.reset();
  db.on(/SELECT id, video_url FROM videos WHERE id = \?/, () => [[{ id: 5, video_url: 'https://www.loom.com/share/abc' }], []]);
  conSuscripcion(true);
  const ok = await http('GET', '/api/videos/5/reproducir', { headers: bearer(tokenTribu(7)) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.video_url, 'https://www.loom.com/share/abc');
});

test('GET /api/eventos/:id/acceso: 401 sin token, 403 sin suscripción, ubicación con suscripción', async () => {
  const evento = { id: 3, nombre: 'Círculo', fecha: '2026-10-20', hora_inicio: '19:00:00', lugar: 'Zoom', ubicacion: 'https://zoom.example/secreto' };
  db.on(/FROM tribu_eventos WHERE id = \? AND activo = 1/, () => [[evento], []]);
  assert.equal((await http('GET', '/api/eventos/3/acceso')).status, 401);
  conSuscripcion(false);
  const sinSus = await http('GET', '/api/eventos/3/acceso', { headers: bearer(tokenTribu(7)) });
  assert.equal(sinSus.status, 403);
  db.reset();
  db.on(/FROM tribu_eventos WHERE id = \? AND activo = 1/, () => [[evento], []]);
  conSuscripcion(true);
  const ok = await http('GET', '/api/eventos/3/acceso', { headers: bearer(tokenTribu(7)) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ubicacion, 'https://zoom.example/secreto');
});

test('comunidad: el feed exige suscripción, los propios logros no, y nunca muestra logros privados ajenos', async () => {
  conSuscripcion(false);
  const sinSus = await http('GET', '/api/posts', { headers: bearer(tokenTribu(7)) });
  assert.equal(sinSus.status, 403);
  db.on(/SELECT COUNT\(\*\) AS total FROM tribu_posts/, () => [[{ total: 0 }], []]);
  const propios = await http('GET', '/api/posts?mine=1', { headers: bearer(tokenTribu(7)) });
  assert.equal(propios.status, 200);

  db.reset();
  conSuscripcion(true);
  db.on(/SELECT COUNT\(\*\) AS total FROM tribu_posts/, () => [[{ total: 0 }], []]);
  const feed = await http('GET', '/api/posts', { headers: bearer(tokenTribu(7)) });
  assert.equal(feed.status, 200);
  const q = db.sqls(/LIMIT \? OFFSET \?/)[0];
  assert.ok(/NOT LIKE \?/.test(q.sql));
  assert.ok(q.params.includes('#tipo:logro_privado%'));

  db.reset();
  conSuscripcion(false);
  const publicar = await http('POST', '/api/posts', { headers: bearer(tokenTribu(7)), body: { contenido: '#tipo:avance\nhola' } });
  assert.equal(publicar.status, 403);
  const like = await http('POST', '/api/posts/1/like', { headers: bearer(tokenTribu(7)) });
  assert.equal(like.status, 403);
});

test('PUT /api/posts/:id responde 500 controlado si falla la BD', async () => {
  db.on(/SELECT id, tribu_user_id, contenido, foto_url FROM tribu_posts/, () => { throw new Error('db caída'); });
  const r = await http('PUT', '/api/posts/1', { headers: bearer(tokenTribu(7)), body: { contenido: 'x' } });
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'Error al actualizar la publicación');
});

test('.ics con DTSTART válido aunque la fecha llegue como Date de mysql2', () => {
  const fecha = new Date('2026-10-09T05:00:00.000Z');
  assert.equal(toYmdLima(fecha), '2026-10-09');
  const ics = buildEventIcs({ id: 3, nombre: 'Círculo', fecha, hora_inicio: '19:00:00', hora_fin: null, lugar: 'Zoom' }, { uidHost: 'example.test' });
  assert.match(ics, /DTSTART;TZID=America\/Lima:20261009T190000\r\n/);
  assert.match(ics, /DTEND;TZID=America\/Lima:20261009T200000\r\n/);
  assert.ok(!/Invalid|NaN|undefined/.test(ics));
});

test('no se puede reservar un evento pasado (fecha como Date)', async () => {
  conSuscripcion(true);
  const ayer = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  db.on(/FROM tribu_eventos WHERE id = \? AND activo = 1/, () =>
    [[{ id: 3, nombre: 'Pasado', fecha: ayer, hora_inicio: '10:00:00', hora_fin: '11:00:00', lugar: 'Zoom' }], []]);
  const r = await http('POST', '/api/eventos/3/reservar', { headers: bearer(tokenTribu(7)) });
  assert.equal(r.status, 400);
  assert.equal(db.sqls(/INSERT INTO tribu_evento_reservas/).length, 0);
});

test('PUT /perfil sin telefono no lo borra; con telefono lo actualiza', async () => {
  db.on(/FROM tribu_users WHERE id = \? LIMIT 1/, () => [[{ id: 7, nombre: 'Test', apellido: 'T', email: 'test@example.test', telefono: '999' }], []]);
  const sin = await http('PUT', '/api/tribu-auth/perfil', { headers: bearer(tokenTribu(7)), body: { nombre: 'Test' } });
  assert.equal(sin.status, 200);
  const upd = db.sqls(/^UPDATE tribu_users SET nombre/)[0];
  assert.ok(upd);
  assert.ok(!/telefono/.test(upd.sql));

  db.reset();
  db.on(/FROM tribu_users WHERE id = \? LIMIT 1/, () => [[{ id: 7, nombre: 'Test', apellido: 'T', email: 'test@example.test' }], []]);
  const con = await http('PUT', '/api/tribu-auth/perfil', { headers: bearer(tokenTribu(7)), body: { nombre: 'Test', telefono: '+51 999 888 777' } });
  assert.equal(con.status, 200);
  const upd2 = db.sqls(/^UPDATE tribu_users SET nombre/)[0];
  assert.ok(/telefono = \?/.test(upd2.sql));
  assert.ok(upd2.params.includes('+51999888777'));
});

test('cuerpo JSON limitado a 100 KB salvo rutas de editor', async () => {
  const grande = JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(150 * 1024) });
  const login = await http('POST', '/api/tribu-auth/login', { body: grande });
  assert.equal(login.status, 413);

  db.on(/FROM tribu_users WHERE id = \? LIMIT 1/, () => [[{ id: 7, nombre: 'Test', apellido: 'T', email: 'test@example.test' }], []]);
  const perfil = await http('PUT', '/api/tribu-auth/perfil', {
    headers: bearer(tokenTribu(7)),
    body: { nombre: 'Test', hobbies: '<p>' + 'h'.repeat(150 * 1024) + '</p>' },
  });
  assert.notEqual(perfil.status, 413);
});

test('requireAcceso: ADMIN sin la llave recibe 403; SUPER_ADMIN pasa y la secret_key va enmascarada', async () => {
  db.on(/FROM tribu_menu_accesos ORDER BY/, () => [[{ id: 1, clave: 'videos' }, { id: 9, clave: 'config' }, { id: 2, clave: 'tribu-users' }], []]);
  db.on(/FROM tribu_usuario_accesos u/, () => [[{ clave: 'videos' }], []]);
  db.on(/FROM config_culqi WHERE id = 1/, () => [[{ activo: 1, modo: 'sandbox', public_key: 'pk_test_1234567890abcdef', secret_key: 'sk_test_supersecreto9876' }], []]);

  const admin = bearer(tokenAdmin(2, 'ADMIN'));
  assert.equal((await http('GET', '/api/config-culqi', { headers: admin })).status, 403);
  assert.equal((await http('GET', '/api/tribu-users', { headers: admin })).status, 403);
  assert.equal((await http('GET', '/api/suscripciones', { headers: admin })).status, 403);
  assert.equal((await http('GET', '/api/usuarios', { headers: admin })).status, 403);

  const sa = await http('GET', '/api/config-culqi', { headers: bearer(tokenAdmin(1, 'SUPER_ADMIN')) });
  assert.equal(sa.status, 200);
  assert.ok(!('secret_key' in sa.json));
  assert.equal(sa.json.secret_key_last4, '9876');
  assert.equal(sa.json.secret_key_configurada, true);
  assert.ok(!/supersecreto/.test(sa.text));
});

test('PUT /api/config-culqi sin secret_key conserva la guardada', async () => {
  db.on(/SELECT secret_key FROM config_culqi WHERE id = 1/, () => [[{ secret_key: 'sk_test_guardada1234' }], []]);
  const headers = { ...bearer(tokenAdmin(1, 'SUPER_ADMIN')), ...(await csrf()) };
  const r = await http('PUT', '/api/config-culqi', { headers, body: { activo: true, modo: 'sandbox', public_key: 'pk_test_abcdefabcdefabcd' } });
  assert.equal(r.status, 200);
  const ins = db.sqls(/INSERT INTO config_culqi/)[0];
  assert.ok(ins.params.includes('sk_test_guardada1234'));
});

test('encuestas: respuesta de texto larga 400 y rate limit por IP', async () => {
  db.on(/SELECT id FROM encuestas WHERE slug = \?/, () => [[{ id: 1 }], []]);
  db.on(/FROM encuestas WHERE id = \?/, () => [[{ id: 1, titulo: 'E', slug: 'e', activa: 1 }], []]);
  db.on(/FROM encuesta_preguntas WHERE encuesta_id = \?/, () => [[{ id: 10, texto: '¿Qué?', tipo: 'text', orden: 1, obligatoria: 0 }], []]);
  db.on(/INSERT INTO encuesta_respuestas/, () => [{ affectedRows: 1, insertId: 50 }, []]);
  const ip = '10.9.9.9';
  const larga = await http('POST', '/api/encuestas/public/e/responder', { ip, body: { respuestas: [{ pregunta_id: 10, texto: 'x'.repeat(2001) }] } });
  assert.equal(larga.status, 400);
  let ultimo;
  for (let i = 0; i < 10; i++) {
    ultimo = await http('POST', '/api/encuestas/public/e/responder', { ip, body: { respuestas: [{ pregunta_id: 10, texto: 'ok' }] } });
  }
  assert.equal(ultimo.status, 429);
});

test('vista/like de videos con rate limit por IP', async () => {
  const ip = '10.8.8.8';
  let r;
  for (let i = 0; i < 61; i++) r = await http('POST', '/api/videos/1/vista', { ip });
  assert.equal(r.status, 429);
});

test('ningún módulo registra listeners de SIGTERM/SIGINT al cargarse', () => {
  assert.equal(typeof shell.gracefulShutdown, 'function');
  assert.equal(process.listenerCount('SIGTERM'), sigtermAntes);
  assert.equal(process.listenerCount('SIGINT'), sigintAntes);
});

test('gracefulShutdown: SIGTERM detiene timers, cierra HTTP, pool y mailer y sale con 0', async () => {
  const orden = [];
  const fakeServer = { listening: true, close(cb) { orden.push('server'); setImmediate(cb); } };
  let codigo = null;
  let resolverSalida;
  const salida = new Promise(r => { resolverSalida = r; });
  const shutdown = crearGracefulShutdown({
    obtenerServidor: () => fakeServer,
    detenerTimers: [() => orden.push('timer1'), () => orden.push('timer2')],
    cerrarPool: async () => { orden.push('pool'); },
    cerrarMailer: () => { orden.push('mailer'); },
    salir: (c) => { codigo = c; resolverSalida(); },
    log: { log() {}, error() {} },
  });
  const proceso = new EventEmitter();
  const quitar = registrarSenales(shutdown, proceso);
  proceso.emit('SIGTERM', 'SIGTERM');
  proceso.emit('SIGTERM', 'SIGTERM');
  await salida;
  quitar();
  assert.equal(codigo, 0);
  assert.deepEqual(orden, ['timer1', 'timer2', 'server', 'pool', 'mailer']);
  assert.equal(proceso.listenerCount('SIGTERM'), 0);
});

test('gracefulShutdown: si algo se cuelga, el timeout de seguridad fuerza la salida', async () => {
  let codigo = null;
  let resolverSalida;
  const salida = new Promise(r => { resolverSalida = r; });
  const shutdown = crearGracefulShutdown({
    cerrarPool: () => new Promise(() => {}),
    timeoutMs: 50,
    salir: (c) => { codigo = c; resolverSalida(); },
    log: { log() {}, error() {} },
  });
  shutdown('SIGTERM');
  await salida;
  assert.equal(codigo, 1);
});

test('asegurarIndiceUnico ignora NULL y bloquea cadenas vacías repetidas', async () => {
  const schemaPath = require.resolve(path.join(ROOT, 'src/schema.js'));
  const stub = require.cache[schemaPath];
  delete require.cache[schemaPath];
  const { asegurarIndiceUnico } = require(schemaPath);
  require.cache[schemaPath] = stub;

  db.on(/SHOW INDEX FROM/, () => [[], []]);
  db.on(/GROUP BY `email` HAVING COUNT/, (params, sql) => {
    if (!/IS NOT NULL/.test(sql)) return [[{ valor: null, total: 3 }], []];
    return [[], []];
  });
  assert.equal(await asegurarIndiceUnico('tribu_users', 'uq_tribu_users_email', 'email'), true);
  assert.equal(db.sqls(/ADD UNIQUE KEY `uq_tribu_users_email`/).length, 1);

  db.reset();
  db.on(/SHOW INDEX FROM/, () => [[], []]);
  db.on(/GROUP BY `culqi_charge_id` HAVING COUNT/, () => [[{ valor: null, total: 4 }], []]);
  assert.equal(await asegurarIndiceUnico('tribu_suscripciones', 'uq_ts_culqi_charge', 'culqi_charge_id'), true);

  db.reset();
  db.on(/SHOW INDEX FROM/, () => [[], []]);
  db.on(/GROUP BY `email` HAVING COUNT/, () => [[{ valor: '', total: 2 }], []]);
  const avisos = [];
  const warn = console.warn;
  console.warn = (m) => avisos.push(String(m));
  try {
    assert.equal(await asegurarIndiceUnico('tribu_users', 'uq_tribu_users_email', 'email'), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(db.sqls(/ADD UNIQUE KEY/).length, 0);
  assert.ok(avisos.some(a => /cadenas vacías/.test(a)));
});
