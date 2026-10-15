const test = require('node:test');
const assert = require('node:assert/strict');
const { hijosDe, expandirGrupos, grupoVisible } = require('../lib/menuGrupos');

test('hijosDe devuelve los submenús de Chats y vacío para otras claves', () => {
  assert.deepEqual(hijosDe('chats'), ['whatsapp', 'social']);
  assert.deepEqual(hijosDe('agenda'), []);
});

test('expandirGrupos: el padre concede todos los hijos', () => {
  const r = expandirGrupos(new Set(['chats', 'agenda']));
  assert.ok(r.has('whatsapp') && r.has('social') && r.has('agenda') && r.has('chats'));
});

test('expandirGrupos: un hijo no concede el padre ni al hermano', () => {
  const r = expandirGrupos(new Set(['whatsapp']));
  assert.ok(r.has('whatsapp'));
  assert.ok(!r.has('social'));
  assert.ok(!r.has('chats'));
});

test('expandirGrupos no muta la entrada', () => {
  const entrada = new Set(['chats']);
  expandirGrupos(entrada);
  assert.equal(entrada.size, 1);
});

test('grupoVisible: visible con padre o con al menos un hijo', () => {
  assert.equal(grupoVisible(new Set(['chats']), 'chats'), true);
  assert.equal(grupoVisible(new Set(['social']), 'chats'), true);
  assert.equal(grupoVisible(new Set(['whatsapp']), 'chats'), true);
  assert.equal(grupoVisible(new Set(['agenda']), 'chats'), false);
  assert.equal(grupoVisible(new Set(), 'chats'), false);
});
