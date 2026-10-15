const crypto = require('crypto');

const VENTANA_HORAS = 24;
const MAX_BYTES_TEXTO = 1000;
const TIMEOUT_MS = 10000;

const TIPOS_ADJUNTO = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
  share: 'share',
  ig_reel: 'share',
  reel: 'share',
  story_mention: 'story_mention',
  location: 'location',
};

const ETIQUETAS = {
  image: '[Imagen]',
  video: '[Video]',
  audio: '[Audio]',
  document: '[Archivo]',
  share: '[Publicación compartida]',
  story_mention: '[Mención en historia]',
  location: '[Ubicación]',
  other: '[Adjunto]',
};

function configMeta() {
  const env = require('../env');
  return {
    appId: env('META_APP_ID') || '',
    appSecret: env('META_APP_SECRET') || '',
    verifyToken: env('META_VERIFY_TOKEN') || '',
    version: env('META_GRAPH_VERSION') || 'v21.0',
  };
}

function hash(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest();
}

function compararSeguro(a, b) {
  if (!a || !b) return false;
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function verificarFirma(cuerpo, cabecera, secreto) {
  if (!secreto || !cabecera || cuerpo == null) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(cabecera).trim());
  if (!m) return false;
  const esperado = crypto.createHmac('sha256', secreto).update(cuerpo).digest();
  return crypto.timingSafeEqual(esperado, Buffer.from(m[1], 'hex'));
}

function normalizarEventos(body) {
  if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) return [];
  const eventos = [];
  for (const entry of body.entry) {
    if (!entry || entry.id == null || !Array.isArray(entry.messaging)) continue;
    for (const ev of entry.messaging) {
      const m = ev && ev.message;
      if (!m || !m.mid || m.is_deleted) continue;
      const eco = m.is_echo === true;
      const usuario = eco ? ev.recipient && ev.recipient.id : ev.sender && ev.sender.id;
      if (usuario == null || usuario === '') continue;

      const adjunto = Array.isArray(m.attachments) && m.attachments.length ? m.attachments[0] : null;
      const texto = typeof m.text === 'string' ? m.text.trim() : '';
      let tipo = 'text';
      let cuerpo = texto;
      if (!texto || adjunto) {
        if (adjunto) {
          tipo = TIPOS_ADJUNTO[adjunto.type] || 'other';
          if (!texto) cuerpo = ETIQUETAS[tipo];
        } else if (!texto) {
          continue;
        }
      }

      const ts = Number(ev.timestamp);
      eventos.push({
        canal: 'instagram',
        cuentaExterna: String(entry.id),
        usuarioExterno: String(usuario),
        direccion: eco ? 'outgoing' : 'incoming',
        mid: String(m.mid),
        tipo,
        cuerpo: cuerpo.slice(0, 4000),
        timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts) : null,
      });
    }
  }
  return eventos;
}

function ventanaAbierta(ultimoEntranteAt, ahora = new Date(), horas = VENTANA_HORAS) {
  if (!ultimoEntranteAt) return false;
  const t = new Date(ultimoEntranteAt).getTime();
  const n = new Date(ahora).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return false;
  return n - t <= horas * 3600 * 1000;
}

function ventanaExpiraAt(ultimoEntranteAt, horas = VENTANA_HORAS) {
  if (!ultimoEntranteAt) return null;
  const t = new Date(ultimoEntranteAt).getTime();
  return Number.isFinite(t) ? new Date(t + horas * 3600 * 1000) : null;
}

function textoValido(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (!t) return { ok: false, error: 'Mensaje vacío' };
  if (Buffer.byteLength(t, 'utf8') > MAX_BYTES_TEXTO) {
    return { ok: false, error: 'El mensaje supera el límite de 1000 bytes de Instagram' };
  }
  return { ok: true, texto: t };
}

function errorMeta(data, status) {
  const e = data && data.error ? data.error : {};
  const err = new Error('Error de la API de Meta');
  err.meta = true;
  err.status = status;
  err.metaCode = e.code != null ? Number(e.code) : null;
  err.metaSubcode = e.error_subcode != null ? Number(e.error_subcode) : null;
  return err;
}

async function llamarGraph(url, { token, metodo = 'GET', cuerpo } = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw errorMeta(data, res.status);
  return data;
}

async function enviarMensaje({ token, destinatario, texto, version }, fetchImpl) {
  const v = version || configMeta().version;
  const data = await llamarGraph(
    `https://graph.facebook.com/${v}/me/messages`,
    {
      token,
      metodo: 'POST',
      cuerpo: {
        recipient: { id: String(destinatario) },
        messaging_type: 'RESPONSE',
        message: { text: texto },
      },
    },
    fetchImpl
  );
  return { messageId: data.message_id || null };
}

async function obtenerPerfil({ token, usuarioId, version }, fetchImpl) {
  const v = version || configMeta().version;
  const data = await llamarGraph(
    `https://graph.facebook.com/${v}/${encodeURIComponent(usuarioId)}?fields=name,username`,
    { token },
    fetchImpl
  );
  return { nombre: data.name || null, username: data.username || null };
}

function mensajeErrorMeta(err) {
  if (err && err.metaCode === 190) return 'El token de Instagram expiró o no es válido. Actualízalo en Integraciones.';
  if (err && [10, 200, 230].includes(err.metaCode)) return 'La cuenta de Instagram no tiene el permiso de mensajería requerido.';
  if (err && (err.metaCode === 551 || err.metaCode === 100)) return 'No se puede escribir a este usuario (fuera de ventana o no disponible).';
  if (err && err.metaCode === 4) return 'Meta limitó temporalmente los envíos. Inténtalo en unos minutos.';
  return 'No se pudo enviar el mensaje por Instagram. Inténtalo nuevamente.';
}

module.exports = {
  VENTANA_HORAS,
  MAX_BYTES_TEXTO,
  configMeta,
  compararSeguro,
  verificarFirma,
  normalizarEventos,
  ventanaAbierta,
  ventanaExpiraAt,
  textoValido,
  enviarMensaje,
  obtenerPerfil,
  mensajeErrorMeta,
};
