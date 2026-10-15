const crypto = require('crypto');
const pool = require('../db');
const { isStaffAdmin } = require('../roles');
const meta = require('./meta');

function errorPublico(status, mensaje, codigo) {
  return Object.assign(new Error(mensaje), { publico: true, status, codigo });
}

const esDuplicado = (err) => err && err.code === 'ER_DUP_ENTRY';

async function cuentaPorExterno(canal, externalId) {
  const [[cuenta]] = await pool.execute(
    'SELECT id, canal, external_id, access_token FROM social_cuentas WHERE canal = ? AND external_id = ? AND activo = 1 LIMIT 1',
    [canal, externalId]
  );
  return cuenta || null;
}

async function obtenerOCrearConversacion(cuenta, usuarioExterno) {
  const buscar = async () => {
    const [[row]] = await pool.execute(
      'SELECT id, nombre FROM social_conversaciones WHERE canal = ? AND cuenta_id = ? AND external_id = ?',
      [cuenta.canal, cuenta.id, usuarioExterno]
    );
    return row || null;
  };
  const existente = await buscar();
  if (existente) return { id: existente.id, nueva: false };
  try {
    const [r] = await pool.execute(
      'INSERT INTO social_conversaciones (canal, cuenta_id, external_id) VALUES (?,?,?)',
      [cuenta.canal, cuenta.id, usuarioExterno]
    );
    return { id: r.insertId, nueva: true };
  } catch (err) {
    if (!esDuplicado(err)) throw err;
    const de_carrera = await buscar();
    return { id: de_carrera.id, nueva: false };
  }
}

async function marcarRespondidos(conversacionId, terapeutaId, cuando) {
  await pool.execute(
    `UPDATE social_mensajes
     SET respondido_at = ?, respondido_por = ?
     WHERE conversacion_id = ? AND direccion = 'incoming'
       AND respondido_at IS NULL AND recibido_at <= ?`,
    [cuando, terapeutaId || null, conversacionId, cuando]
  );
}

async function registrarEvento(ev, cuenta) {
  const { id: conversacionId, nueva } = await obtenerOCrearConversacion(cuenta, ev.usuarioExterno);
  const cuando = ev.timestamp || new Date();

  try {
    await pool.execute(
      `INSERT INTO social_mensajes (conversacion_id, canal, mid, direccion, tipo, cuerpo, recibido_at)
       VALUES (?,?,?,?,?,?,?)`,
      [conversacionId, ev.canal, ev.mid, ev.direccion, ev.tipo, ev.cuerpo, cuando]
    );
  } catch (err) {
    if (esDuplicado(err)) return { duplicado: true };
    throw err;
  }

  const resumen = ev.cuerpo.slice(0, 255);
  if (ev.direccion === 'incoming') {
    await pool.execute(
      `UPDATE social_conversaciones
       SET ultimo_mensaje = IF(ultimo_mensaje_at IS NULL OR ultimo_mensaje_at <= ?, ?, ultimo_mensaje),
           ultimo_mensaje_at = IF(ultimo_mensaje_at IS NULL OR ultimo_mensaje_at <= ?, ?, ultimo_mensaje_at),
           ultimo_entrante_at = GREATEST(COALESCE(ultimo_entrante_at, ?), ?),
           no_leidos = no_leidos + 1,
           estado = 'abierta'
       WHERE id = ?`,
      [cuando, resumen, cuando, cuando, cuando, cuando, conversacionId]
    );
  } else {
    await pool.execute(
      `UPDATE social_conversaciones
       SET ultimo_mensaje = IF(ultimo_mensaje_at IS NULL OR ultimo_mensaje_at <= ?, ?, ultimo_mensaje),
           ultimo_mensaje_at = IF(ultimo_mensaje_at IS NULL OR ultimo_mensaje_at <= ?, ?, ultimo_mensaje_at)
       WHERE id = ?`,
      [cuando, resumen, cuando, cuando, conversacionId]
    );
    await marcarRespondidos(conversacionId, null, cuando);
  }

  return { duplicado: false, conversacionId, nueva };
}

async function procesarEventos(eventos) {
  const cuentas = new Map();
  const nuevas = [];
  for (const ev of eventos) {
    const clave = `${ev.canal}:${ev.cuentaExterna}`;
    if (!cuentas.has(clave)) cuentas.set(clave, await cuentaPorExterno(ev.canal, ev.cuentaExterna));
    const cuenta = cuentas.get(clave);
    if (!cuenta) {
      console.warn('[social/webhook] evento de cuenta no registrada, se ignora');
      continue;
    }
    const r = await registrarEvento(ev, cuenta);
    if (r.nueva) nuevas.push({ conversacionId: r.conversacionId, cuenta, usuarioExterno: ev.usuarioExterno });
  }
  return nuevas;
}

async function completarPerfiles(nuevas) {
  for (const n of nuevas) {
    if (!n.cuenta.access_token) continue;
    try {
      const p = await meta.obtenerPerfil({ token: n.cuenta.access_token, usuarioId: n.usuarioExterno });
      await pool.execute(
        'UPDATE social_conversaciones SET nombre = COALESCE(?, nombre), username = COALESCE(?, username) WHERE id = ?',
        [p.nombre ? p.nombre.slice(0, 150) : null, p.username ? p.username.slice(0, 100) : null, n.conversacionId]
      );
    } catch (err) {
      console.warn('[social/perfil] no se pudo obtener el perfil (codigo=%s)', err.metaCode || err.code || 'n/d');
    }
  }
}

function filtroVisibilidad(user, alias = 'c') {
  if (isStaffAdmin(user.rol)) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.asignado_a = ?`, params: [user.id] };
}

async function cargarConversacionVisible(id, user) {
  const f = filtroVisibilidad(user, 'c');
  const [[conv]] = await pool.execute(
    `SELECT c.*, a.access_token
     FROM social_conversaciones c
     JOIN social_cuentas a ON a.id = c.cuenta_id
     WHERE c.id = ?${f.sql}`,
    [id, ...f.params]
  );
  return conv || null;
}

async function enviarRespuesta({ conversacionId, user, texto }) {
  const v = meta.textoValido(texto);
  if (!v.ok) throw errorPublico(400, v.error);

  const conv = await cargarConversacionVisible(conversacionId, user);
  if (!conv) throw errorPublico(404, 'Conversación no encontrada');
  if (!conv.access_token) throw errorPublico(409, 'La cuenta de Instagram no tiene token configurado. Ve a Integraciones.', 'SIN_TOKEN');
  if (!meta.ventanaAbierta(conv.ultimo_entrante_at)) {
    throw errorPublico(409, 'Pasaron más de 24 horas desde el último mensaje del usuario. Instagram no permite responder.', 'VENTANA_CERRADA');
  }

  let resultado;
  try {
    resultado = await meta.enviarMensaje({ token: conv.access_token, destinatario: conv.external_id, texto: v.texto });
  } catch (err) {
    console.error('[social/enviar] conversacion_id=%s codigo=%s status=%s', conv.id, err.metaCode || err.code || 'n/d', err.status || 'n/d');
    throw errorPublico(502, meta.mensajeErrorMeta(err), 'ERROR_META');
  }

  const mid = resultado.messageId || `crm-${crypto.randomUUID()}`;
  const ahora = new Date();
  let id = null;
  try {
    const [r] = await pool.execute(
      `INSERT INTO social_mensajes (conversacion_id, canal, mid, direccion, tipo, cuerpo, enviado_por, recibido_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [conv.id, conv.canal, mid, 'outgoing', 'text', v.texto, user.id, ahora]
    );
    id = r.insertId;
    await pool.execute(
      `UPDATE social_conversaciones
       SET ultimo_mensaje = ?, ultimo_mensaje_at = ?, no_leidos = 0
       WHERE id = ?`,
      [v.texto.slice(0, 255), ahora, conv.id]
    );
    await marcarRespondidos(conv.id, user.id, ahora);
  } catch (err) {
    if (!esDuplicado(err)) throw err;
    const [[eco]] = await pool.execute('SELECT id, recibido_at FROM social_mensajes WHERE mid = ?', [mid]);
    if (eco) {
      id = eco.id;
      await pool.execute('UPDATE social_mensajes SET enviado_por = COALESCE(enviado_por, ?) WHERE id = ?', [user.id, eco.id]);
      await pool.execute(
        `UPDATE social_mensajes SET respondido_por = ?
         WHERE conversacion_id = ? AND direccion = 'incoming' AND respondido_por IS NULL AND respondido_at = ?`,
        [user.id, conv.id, eco.recibido_at]
      );
    }
  }
  return { id, mid };
}

module.exports = {
  ...meta,
  procesarEventos,
  completarPerfiles,
  filtroVisibilidad,
  cargarConversacionVisible,
  enviarRespuesta,
  errorPublico,
};
