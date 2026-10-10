const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');

for (const k of Object.keys(process.env)) {
  if (/^(SMTP_|DB_|EMAIL_CONFIG_DB_|APP_SITE_PREFIX)/.test(k)) delete process.env[k];
}
process.env.TZ = 'America/Lima';

const mailer = require(path.join(ROOT, 'lib/mailer.js'));
const { crearGracefulShutdown } = require(path.join(ROOT, 'src/lib/apagado.js'));

const FILA = {
  smtp_host: 'smtp.example.test',
  smtp_port: 465,
  smtp_secure: 1,
  smtp_user: 'noreply@example.test',
  smtp_pass: 'secreto-1',
  email_from: 'noreply@example.test',
  nombre_from: 'Vive Hoy Mejor',
};

function crearEntorno({ fila = FILA, fallar = false } = {}) {
  const estado = { fila: { ...fila }, fallar, consultas: [], getPool: 0, transportes: [], enviados: [], ahora: 1_000_000 };
  const pool = {
    async query(sql) {
      estado.consultas.push(sql);
      if (estado.fallar) { const e = new Error("SELECT command denied to user 'x'"); e.code = 'ER_TABLEACCESS_DENIED_ERROR'; throw e; }
      return [[{ ...estado.fila }], []];
    },
  };
  const createTransport = (opts) => {
    const t = {
      opts,
      cerrado: false,
      close() { this.cerrado = true; },
      async sendMail(msg) { estado.enviados.push({ transporte: t, msg }); return { messageId: 'x' }; },
    };
    estado.transportes.push(t);
    return t;
  };
  mailer._resetForTests({ getPool: () => { estado.getPool++; return pool; }, createTransport, ahora: () => estado.ahora });
  return estado;
}

function limpiarEnv() {
  for (const k of Object.keys(process.env)) {
    if (/^(SMTP_|DB_|EMAIL_CONFIG_DB_)/.test(k)) delete process.env[k];
  }
}

function silenciar(t) {
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  t.after(() => { console.warn = warn; });
  return avisos;
}

function enviar(to = 'a@example.test') {
  return mailer.sendMail({ to, subject: 's', text: 't' });
}

test.beforeEach(() => limpiarEnv());

test('config_email: lee la fila id=1 de ssfdgwtm_vhm con el pool existente y construye el transporter', async (t) => {
  silenciar(t);
  const e = crearEntorno();

  assert.equal(await mailer.isMailerConfigured(), true);
  assert.equal(e.consultas.length, 1);
  assert.match(e.consultas[0], /FROM `ssfdgwtm_vhm`\.config_email WHERE id = 1/);

  const r = await enviar();
  assert.deepEqual(r, { ok: true });
  assert.equal(e.transportes.length, 1);
  const to = e.transportes[0].opts;
  assert.equal(to.host, 'smtp.example.test');
  assert.equal(to.port, 465);
  assert.equal(to.secure, true);
  assert.deepEqual(to.auth, { user: 'noreply@example.test', pass: 'secreto-1' });
  assert.equal(e.enviados[0].msg.from, '"Vive Hoy Mejor" <noreply@example.test>');
  assert.equal(e.consultas.length, 1);
});

test('EMAIL_CONFIG_DB_NAME: cambia la BD consultada y se rechaza si no cumple ^[A-Za-z0-9_]+$', async (t) => {
  const avisos = silenciar(t);
  process.env.EMAIL_CONFIG_DB_NAME = 'otra_bd_1';
  let e = crearEntorno();
  await mailer.isMailerConfigured();
  assert.match(e.consultas[0], /FROM `otra_bd_1`\.config_email/);

  for (const malo of ['bd`; DROP TABLE x; --', 'bd.config', 'bd-x', 'bd x']) {
    process.env.EMAIL_CONFIG_DB_NAME = malo;
    e = crearEntorno();
    assert.equal(await mailer.isMailerConfigured(), false, malo);
    assert.equal(e.consultas.length, 0, 'no se ejecuta SQL con un nombre inválido');
  }
  assert.ok(avisos.some(a => a.includes('EMAIL_CONFIG_DB_NAME_INVALIDO')));
});

test('caché: no vuelve a consultar dentro del TTL de 10 min y refresca después', async (t) => {
  silenciar(t);
  const e = crearEntorno();
  await enviar();
  await enviar('b@example.test');
  assert.equal(await mailer.isMailerConfigured(), true);
  assert.equal(e.consultas.length, 1);
  assert.equal(mailer._internals.CONFIG_TTL_MS, 10 * 60 * 1000);

  e.ahora += mailer._internals.CONFIG_TTL_MS - 1;
  await enviar();
  assert.equal(e.consultas.length, 1);

  e.ahora += 2;
  await enviar();
  assert.equal(e.consultas.length, 2);
  assert.equal(e.transportes.length, 1, 'misma configuración: se reutiliza el transporter');
});

test('caché: lecturas concurrentes comparten una sola consulta', async (t) => {
  silenciar(t);
  const e = crearEntorno();
  const r = await Promise.all([mailer.isMailerConfigured(), mailer.isMailerConfigured(), enviar()]);
  assert.deepEqual(r.slice(0, 2), [true, true]);
  assert.equal(e.consultas.length, 1);
});

test('cambio de configuración: recrea el transporter y cierra el anterior', async (t) => {
  silenciar(t);
  const e = crearEntorno();
  await enviar();
  assert.equal(e.transportes.length, 1);

  e.fila.smtp_pass = 'secreto-2';
  e.ahora += mailer._internals.CONFIG_TTL_MS + 1;
  await enviar();
  assert.equal(e.transportes.length, 2);
  assert.equal(e.transportes[0].cerrado, true);
  assert.equal(e.transportes[1].opts.auth.pass, 'secreto-2');
  assert.equal(e.enviados[1].transporte, e.transportes[1]);

  e.fila.smtp_host = 'smtp2.example.test';
  e.ahora += mailer._internals.CONFIG_TTL_MS + 1;
  await enviar();
  assert.equal(e.transportes.length, 3);
  assert.equal(e.transportes[1].cerrado, true);
  assert.equal(e.transportes[2].opts.host, 'smtp2.example.test');

  e.fila.nombre_from = 'Otro nombre';
  e.ahora += mailer._internals.CONFIG_TTL_MS + 1;
  await enviar();
  assert.equal(e.transportes.length, 3, 'cambiar solo el remitente no recrea el transporter');
  assert.equal(e.enviados[3].msg.from, '"Otro nombre" <noreply@example.test>');
});

test('fallo de BD: cae a SMTP_* con aviso sin datos sensibles', async (t) => {
  const avisos = silenciar(t);
  process.env.SMTP_HOST = 'smtp.env.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'env-user';
  process.env.SMTP_PASS = 'env-pass-secreta';
  process.env.SMTP_FROM = 'Tribu <tribu@example.test>';
  const e = crearEntorno({ fallar: true });

  assert.equal(await mailer.isMailerConfigured(), true);
  assert.deepEqual(await enviar(), { ok: true });
  assert.equal(e.transportes[0].opts.host, 'smtp.env.test');
  assert.equal(e.transportes[0].opts.secure, false);
  assert.equal(e.enviados[0].msg.from, 'Tribu <tribu@example.test>');
  assert.ok(avisos.some(a => a.includes('config_email') && a.includes('ER_TABLEACCESS_DENIED_ERROR') && a.includes('SMTP_*')));
  assert.ok(avisos.every(a => !a.includes('env-pass-secreta') && !a.includes("user 'x'")));
});

test('fallo de BD sin SMTP_*: no envía y lo avisa', async (t) => {
  const avisos = silenciar(t);
  const e = crearEntorno({ fallar: true });
  assert.equal(await mailer.isMailerConfigured(), false);
  assert.deepEqual(await enviar(), { skipped: true });
  assert.equal(e.transportes.length, 0);
  assert.ok(avisos.some(a => a.includes('no se envían correos')));
});

test('fallo al obtener el pool (env DB ausente): cae a SMTP_*', async (t) => {
  silenciar(t);
  process.env.SMTP_HOST = 'smtp.env.test';
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASS = 'p';
  mailer._resetForTests({ getPool: () => { throw new Error('Missing env: DB_HOST'); }, createTransport: () => ({ close() {}, async sendMail() {} }) });
  assert.equal(await mailer.isMailerConfigured(), true);
  assert.deepEqual(await enviar(), { ok: true });
});

test('fallo de BD tras una carga correcta: mantiene la última config_email y reintenta pronto', async (t) => {
  silenciar(t);
  const e = crearEntorno();
  assert.equal(await mailer.isMailerConfigured(), true);
  e.fallar = true;
  e.ahora += mailer._internals.CONFIG_TTL_MS + 1;
  assert.equal(await mailer.isMailerConfigured(), true);
  assert.equal(e.consultas.length, 2);
  await enviar();
  assert.equal(e.transportes[0].opts.host, 'smtp.example.test');
  assert.equal(e.consultas.length, 2);

  e.fallar = false;
  e.ahora += mailer._internals.REINTENTO_TRAS_FALLO_MS + 1;
  await mailer.isMailerConfigured();
  assert.equal(e.consultas.length, 3);
});

test('config_email incompleta o sin fila: se trata como fallo y sin SMTP_* no envía', async (t) => {
  const avisos = silenciar(t);
  let e = crearEntorno({ fila: { ...FILA, smtp_pass: '' } });
  assert.equal(await mailer.isMailerConfigured(), false);
  assert.equal(e.transportes.length, 0);
  assert.ok(avisos.some(a => a.includes('CONFIG_EMAIL_INCOMPLETA')));

  e = crearEntorno();
  mailer._resetForTests({ getPool: () => ({ query: async () => [[], []] }), createTransport: () => { throw new Error('no debe crearse'); } });
  assert.equal(await mailer.isMailerConfigured(), false);
  assert.ok(avisos.some(a => a.includes('CONFIG_EMAIL_SIN_FILA')));
});

test('remitente: limpia comillas y saltos de línea de nombre_from y usa smtp_user si falta email_from', () => {
  const cfg = mailer._internals.configDesdeFila({ ...FILA, nombre_from: 'Mal"o\r\nBcc: x@y', email_from: '' });
  assert.equal(cfg.from, '"MaloBcc: x@y" <noreply@example.test>');
  assert.equal(mailer._internals.configDesdeFila({ ...FILA, nombre_from: '' }).from, 'noreply@example.test');
  assert.equal(mailer._internals.configDesdeFila({ ...FILA, smtp_secure: 0 }).secure, false);
});

test('apagado: gracefulShutdown cierra el transporter (el pool es el de src/db.js, cerrado por cerrarPool)', async (t) => {
  silenciar(t);
  const e = crearEntorno();
  await enviar();
  let codigo = null;
  let poolCerrado = false;
  let resolver;
  const salida = new Promise(r => { resolver = r; });
  const shutdown = crearGracefulShutdown({
    cerrarPool: async () => { poolCerrado = true; },
    cerrarMailer: () => mailer.closeMailer(),
    salir: (c) => { codigo = c; resolver(); },
    log: { log() {}, error() {} },
  });
  shutdown('SIGTERM');
  await salida;
  assert.equal(codigo, 0);
  assert.equal(poolCerrado, true);
  assert.equal(e.transportes[0].cerrado, true);
});

test('el mailer no crea pools propios: reutiliza src/db.js', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'lib/mailer.js'), 'utf8');
  assert.doesNotMatch(src, /createPool|createConnection/);
  assert.match(src, /require\('\.\.\/src\/db'\)/);
});
