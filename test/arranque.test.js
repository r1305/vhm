const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// BD inalcanzable a propósito: ninguna consulta puede llegar a producción.
const db = { DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test_unificado' };
const conPrefijo = (p, vars) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [p + k, v]));
Object.assign(process.env, {
  NODE_ENV: 'test',
  ...conPrefijo('CRM_', { ...db, JWT_SECRET: crypto.randomBytes(32).toString('hex'), TRIBU_DB_HOST: '127.0.0.1', TRIBU_DB_PORT: '1', TRIBU_DB_NAME: '' }),
  ...conPrefijo('TRIBU_', { ...db, JWT_SECRET: crypto.randomBytes(32).toString('hex'), CRON_ENABLED: '0', RENOVACION_CRON_ENABLED: '0' }),
  ...conPrefijo('LUMA_', { ...db, JWT_SECRET: crypto.randomBytes(32).toString('hex') }),
  ...conPrefijo('SITE_', { ...db, JWT_SECRET: crypto.randomBytes(32).toString('hex') }),
  APP_MOUNT_PATH: '/otro',
  JWT_SECRET: 'sin-prefijo-no-debe-usarse',
});

const { crearAppUnificada } = require('../app');

test('entry unificado monta crm, luma, latribu y site en un solo servidor', async (t) => {
  const { app, cerrar } = crearAppUnificada({ cargarEnv: false });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await cerrar(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, opts = {}) => fetch(base + p, { redirect: 'manual', ...opts });
  const baseInyectada = async (p) => {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    return (await res.text()).match(/window\.__APP_BASE__=("[^"]*")/)?.[1];
  };

  assert.equal((await (await get('/health')).json()).service, 'vhm-unificado');
  assert.equal((await (await get('/crm/health')).json()).service, 'vhm-crm');
  assert.match((await get('/crm/')).headers.get('location'), /^\/crm\//);

  assert.equal(await baseInyectada('/latribu'), '"/latribu"');
  assert.equal(await baseInyectada('/luma/'), '"/luma"');
  assert.equal(await baseInyectada('/'), '""');

  const encuestaTribu = await get('/latribu/encuesta/abc');
  assert.equal(encuestaTribu.status, 200);
  const encuestaSite = await get('/encuesta/abc');
  assert.equal(encuestaSite.status, 301);
  assert.equal(encuestaSite.headers.get('location'), 'https://vhm.com.pe/latribu/encuesta/abc');

  assert.equal((await get('/latribu/no-existe')).status, 404);
  assert.equal((await get('/crm/api/no-existe', { method: 'POST' })).status, 404);
});

test('cargador de entorno: prefijo por app, ajustes privados y comunes compartidos', () => {
  const envVhm = require('../lib/env');
  const crm = require('../crm/lib/env');
  const tribu = require('../latribu/lib/env');
  assert.equal(crm('DB_NAME'), 'test_unificado');
  assert.notEqual(crm('JWT_SECRET'), process.env.JWT_SECRET);
  assert.notEqual(crm('JWT_SECRET'), tribu('JWT_SECRET'));
  assert.equal(crm('NODE_ENV'), 'test');
  assert.equal(crm('NO_EXISTE', 'x'), 'x');
  crm.set('SMTP_HOST', '');
  assert.equal(crm('SMTP_HOST'), '');
  assert.equal(process.env.SMTP_HOST, undefined);
  assert.equal(process.env.CRM_SMTP_HOST, undefined);
  process.env.SOLO_SIN_PREFIJO = 'v';
  assert.equal(tribu('SOLO_SIN_PREFIJO'), undefined);
  envVhm.configurar({ estricto: false, archivos: false });
  assert.equal(tribu('SOLO_SIN_PREFIJO'), 'v');
  envVhm.configurar({ estricto: true, archivos: false });
  delete process.env.SOLO_SIN_PREFIJO;
});
