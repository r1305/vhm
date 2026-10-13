const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, listSlugs, getDefault } = require('../lib/tribuContenidoDefaults');
const { validarDatos, combinarConDefaults, describirCampos } = require('../lib/tribuContenidoCampos');

test('los textos originales de todas las secciones pasan la validación', () => {
  for (const slug of listSlugs()) assert.deepEqual(validarDatos(slug, getDefault(slug)), [], slug);
});

test('todas las claves tienen etiqueta en español distinta del nombre técnico', () => {
  for (const slug of listSlugs()) {
    for (const c of describirCampos(slug)) assert.notEqual(c.etiqueta, c.clave, `${slug}.${c.clave}`);
  }
});

test('validarDatos rechaza claves desconocidas, tipos incorrectos y vacíos', () => {
  const campos = errs => errs.map(e => e.campo);
  assert.deepEqual(campos(validarDatos('landing_hero', { inventada: 'x' })), ['inventada']);
  assert.deepEqual(campos(validarDatos('landing_hero', { stripe: 'no es lista' })), ['stripe']);
  assert.deepEqual(campos(validarDatos('landing_hero', { stripe: [] })), ['stripe']);
  assert.deepEqual(campos(validarDatos('landing_hero', { lead: 5 })), ['lead']);
  assert.deepEqual(campos(validarDatos('landing_hero', { lead: '   ' })), ['lead']);
  assert.deepEqual(campos(validarDatos('landing_hero', { lead: 'x'.repeat(5000) })), ['lead']);
  assert.deepEqual(campos(validarDatos('landing_hero', { titulo_html: 'Hola <img src=x onerror=alert(1)>' })), ['titulo_html']);
  assert.deepEqual(campos(validarDatos('funnel_empezar', { max_intereses: '3' })), ['max_intereses']);
  assert.deepEqual(campos(validarDatos('funnel_empezar', { step_labels: ['a', 'b'] })), ['step_labels']);
  assert.deepEqual(campos(validarDatos('landing_faq', { items: [{ pregunta: '¿?', respuesta: '' }] })), ['items.0.respuesta']);
  assert.deepEqual(campos(validarDatos('landing_faq', { items: [{ pregunta: '¿?', respuesta: 'Sí', otra: 1 }] })), ['items.0']);
  assert.equal(validarDatos('landing_hero', ['x']).length, 1);
});

test('validarDatos acepta campos parciales y opcionales vacíos', () => {
  assert.deepEqual(validarDatos('landing_hero', { lead: 'Nuevo texto' }), []);
  assert.deepEqual(validarDatos('landing_faq', { items: [{ pregunta: '¿?', respuesta: 'Sí', clave: '' }] }), []);
});

test('combinarConDefaults rellena claves que faltan, vacías o con tipo erróneo, sin mutar DEFAULTS', () => {
  const r = combinarConDefaults('landing_hero', { eyebrow: 'Guardado', lead: '', stripe: 'mal', extra: 'x' });
  assert.equal(r.eyebrow, 'Guardado');
  assert.equal(r.lead, DEFAULTS.landing_hero.lead);
  assert.deepEqual(r.stripe, DEFAULTS.landing_hero.stripe);
  assert.equal(r.titulo_html, DEFAULTS.landing_hero.titulo_html);
  assert.equal('extra' in r, false);
  r.stripe.push('mutado');
  assert.equal(DEFAULTS.landing_hero.stripe.includes('mutado'), false);
  assert.deepEqual(combinarConDefaults('landing_hero', null), getDefault('landing_hero'));
  assert.deepEqual(combinarConDefaults('landing_hero', []), getDefault('landing_hero'));
});
