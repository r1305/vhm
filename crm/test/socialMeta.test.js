const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  verificarFirma,
  normalizarEventos,
  ventanaAbierta,
  ventanaExpiraAt,
  textoValido,
  compararSeguro,
  enviarMensaje,
} = require('../lib/social/meta');

const SECRETO = 'secreto-de-prueba';
const firmar = (cuerpo, secreto = SECRETO) =>
  'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');

test('firma valida se acepta (Buffer y string)', () => {
  const cuerpo = Buffer.from('{"object":"instagram"}');
  assert.strictEqual(verificarFirma(cuerpo, firmar(cuerpo), SECRETO), true);
  assert.strictEqual(verificarFirma('{"a":1}', firmar('{"a":1}'), SECRETO), true);
});

test('firma con otro secreto, alterada o con formato invalido se rechaza', () => {
  const cuerpo = Buffer.from('{"object":"instagram"}');
  assert.strictEqual(verificarFirma(cuerpo, firmar(cuerpo, 'otro'), SECRETO), false);
  assert.strictEqual(verificarFirma(Buffer.from('{"object":"x"}'), firmar(cuerpo), SECRETO), false);
  assert.strictEqual(verificarFirma(cuerpo, 'sha256=zzzz', SECRETO), false);
  assert.strictEqual(verificarFirma(cuerpo, firmar(cuerpo).replace('sha256=', 'sha1='), SECRETO), false);
  assert.strictEqual(verificarFirma(cuerpo, '', SECRETO), false);
  assert.strictEqual(verificarFirma(cuerpo, undefined, SECRETO), false);
});

test('sin secreto o sin cuerpo crudo se rechaza', () => {
  const cuerpo = Buffer.from('{}');
  assert.strictEqual(verificarFirma(cuerpo, firmar(cuerpo), ''), false);
  assert.strictEqual(verificarFirma(undefined, firmar(cuerpo), SECRETO), false);
});

test('compararSeguro compara tokens sin importar el largo', () => {
  assert.strictEqual(compararSeguro('abc', 'abc'), true);
  assert.strictEqual(compararSeguro('abc', 'abcd'), false);
  assert.strictEqual(compararSeguro('abc', ''), false);
});

const cuerpoBase = (messaging) => ({ object: 'instagram', entry: [{ id: '1789', time: 1, messaging }] });

test('normaliza mensaje entrante de texto', () => {
  const evs = normalizarEventos(cuerpoBase([{
    sender: { id: 'U1' }, recipient: { id: '1789' }, timestamp: 1760000000000,
    message: { mid: 'm1', text: ' Hola ' },
  }]));
  assert.strictEqual(evs.length, 1);
  assert.deepStrictEqual(
    { ...evs[0], timestamp: evs[0].timestamp.getTime() },
    {
      canal: 'instagram', cuentaExterna: '1789', usuarioExterno: 'U1', direccion: 'incoming',
      mid: 'm1', tipo: 'text', cuerpo: 'Hola', timestamp: 1760000000000,
    }
  );
});

test('eco: el usuario es el destinatario y la direccion es outgoing', () => {
  const [ev] = normalizarEventos(cuerpoBase([{
    sender: { id: '1789' }, recipient: { id: 'U2' }, timestamp: 1760000000000,
    message: { mid: 'm2', text: 'respuesta', is_echo: true },
  }]));
  assert.strictEqual(ev.direccion, 'outgoing');
  assert.strictEqual(ev.usuarioExterno, 'U2');
});

test('adjunto sin texto usa etiqueta y tipo; ignora lecturas, borrados y otros objetos', () => {
  const evs = normalizarEventos(cuerpoBase([
    { sender: { id: 'U1' }, message: { mid: 'm3', attachments: [{ type: 'image' }] } },
    { sender: { id: 'U1' }, message: { mid: 'm4', attachments: [{ type: 'raro' }] } },
    { sender: { id: 'U1' }, read: { mid: 'm5' } },
    { sender: { id: 'U1' }, message: { mid: 'm6', is_deleted: true } },
    { sender: { id: 'U1' }, message: { text: 'sin mid' } },
    { message: { mid: 'm7', text: 'sin remitente' } },
    { sender: { id: 'U1' }, message: { mid: 'm8' } },
  ]));
  assert.deepStrictEqual(evs.map(e => [e.mid, e.tipo, e.cuerpo]), [
    ['m3', 'image', '[Imagen]'],
    ['m4', 'other', '[Adjunto]'],
  ]);
  assert.strictEqual(evs[0].timestamp, null);
  assert.deepStrictEqual(normalizarEventos({ object: 'page', entry: [] }), []);
  assert.deepStrictEqual(normalizarEventos(null), []);
  assert.deepStrictEqual(normalizarEventos({ object: 'instagram' }), []);
});

test('ventana de 24 h: limites y entradas invalidas', () => {
  const ahora = new Date('2026-10-15T12:00:00-05:00');
  const hace = (h) => new Date(ahora.getTime() - h * 3600 * 1000);
  assert.strictEqual(ventanaAbierta(hace(1), ahora), true);
  assert.strictEqual(ventanaAbierta(hace(24), ahora), true);
  assert.strictEqual(ventanaAbierta(new Date(hace(24).getTime() - 1), ahora), false);
  assert.strictEqual(ventanaAbierta(hace(48), ahora), false);
  assert.strictEqual(ventanaAbierta(null, ahora), false);
  assert.strictEqual(ventanaAbierta('no es fecha', ahora), false);
  assert.strictEqual(ventanaAbierta(hace(10), ahora, 8), false);
});

test('ventanaExpiraAt suma 24 h', () => {
  const t = new Date('2026-10-15T08:00:00-05:00');
  assert.strictEqual(ventanaExpiraAt(t).getTime(), t.getTime() + 24 * 3600 * 1000);
  assert.strictEqual(ventanaExpiraAt(null), null);
});

test('textoValido: vacio y limite de 1000 bytes', () => {
  assert.strictEqual(textoValido('   ').ok, false);
  assert.deepStrictEqual(textoValido('  hola '), { ok: true, texto: 'hola' });
  assert.strictEqual(textoValido('a'.repeat(1000)).ok, true);
  assert.strictEqual(textoValido('a'.repeat(1001)).ok, false);
  assert.strictEqual(textoValido('ñ'.repeat(501)).ok, false);
});

test('enviarMensaje usa el token en cabecera y no en la URL', async () => {
  let llamada;
  const falso = async (url, opts) => {
    llamada = { url, opts };
    return { ok: true, json: async () => ({ message_id: 'mid.abc' }) };
  };
  const r = await enviarMensaje({ token: 'TOK', destinatario: 'U1', texto: 'hola', version: 'v21.0' }, falso);
  assert.strictEqual(r.messageId, 'mid.abc');
  assert.ok(!llamada.url.includes('TOK'));
  assert.strictEqual(llamada.opts.headers.Authorization, 'Bearer TOK');
  assert.deepStrictEqual(JSON.parse(llamada.opts.body).recipient, { id: 'U1' });
});

test('enviarMensaje traduce error de Meta sin exponer el cuerpo', async () => {
  const falso = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'token EAAG secreto' } }) });
  await assert.rejects(
    () => enviarMensaje({ token: 'TOK', destinatario: 'U1', texto: 'x', version: 'v21.0' }, falso),
    (err) => err.metaCode === 190 && !err.message.includes('EAAG')
  );
});
