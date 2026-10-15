const test = require('node:test');
const assert = require('node:assert');
const { fechaValida, normHora } = require('../lib/horaFecha');

test('fechaValida', () => {
  assert.strictEqual(fechaValida('2026-02-31'), false);
  assert.strictEqual(fechaValida('2026-02-28'), true);
  assert.strictEqual(fechaValida('2028-02-29'), true);
  assert.strictEqual(fechaValida('2027-02-29'), false);
  assert.strictEqual(fechaValida('2026-13-01'), false);
  assert.strictEqual(fechaValida(''), false);
});

test('normHora', () => {
  assert.strictEqual(normHora('9:30'), '09:30:00');
  assert.strictEqual(normHora('17:00:00'), '17:00:00');
  assert.strictEqual(normHora('17:00'), '17:00:00');
  assert.strictEqual(normHora('25:00'), null);
  assert.strictEqual(normHora(null), null);
});
