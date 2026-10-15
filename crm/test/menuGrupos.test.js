const test = require('node:test');
const assert = require('node:assert/strict');
const { GRUPOS_UI, hijosDe, grupoVisible } = require('../lib/menuGrupos');
const { estadoPadre, aplicarPadre } = require('../public/menu_grupos_ui');

test('hijosDe devuelve los submenús de Chats y vacío para otras claves', () => {
  assert.deepEqual(hijosDe('chats'), ['whatsapp', 'social']);
  assert.deepEqual(hijosDe('agenda'), []);
  assert.deepEqual(GRUPOS_UI.chats.hijos, ['whatsapp', 'social']);
});

test('grupoVisible: el padre se ve con al menos un hijo permitido', () => {
  assert.equal(grupoVisible(new Set(['social']), 'chats'), true);
  assert.equal(grupoVisible(new Set(['whatsapp']), 'chats'), true);
  assert.equal(grupoVisible(new Set(['whatsapp', 'social']), 'chats'), true);
});

test('grupoVisible: sin hijos permitidos no se ve, y la clave chats no concede nada', () => {
  assert.equal(grupoVisible(new Set(['agenda']), 'chats'), false);
  assert.equal(grupoVisible(new Set(), 'chats'), false);
  assert.equal(grupoVisible(new Set(['chats']), 'chats'), false);
});

test('estadoPadre: marcado, indeterminado o vacío según los hijos', () => {
  const h = hijosDe('chats');
  assert.equal(estadoPadre(new Set(['whatsapp', 'social']), h), 'marcado');
  assert.equal(estadoPadre(new Set(['social']), h), 'indeterminado');
  assert.equal(estadoPadre(new Set(['agenda']), h), 'vacio');
});

test('aplicarPadre: marcar/desmarcar solo toca los hijos y no muta la entrada', () => {
  const h = hijosDe('chats');
  const entrada = new Set(['agenda', 'social']);
  const on = aplicarPadre(entrada, h, true);
  assert.deepEqual([...on].sort(), ['agenda', 'social', 'whatsapp']);
  const off = aplicarPadre(on, h, false);
  assert.deepEqual([...off], ['agenda']);
  assert.deepEqual([...entrada].sort(), ['agenda', 'social']);
});

test('quitar un hijo deja el otro y el padre en indeterminado', () => {
  const h = hijosDe('chats');
  const marcados = new Set(['whatsapp', 'social']);
  marcados.delete('whatsapp');
  assert.equal(estadoPadre(marcados, h), 'indeterminado');
  assert.ok(marcados.has('social'));
});
