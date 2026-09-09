const { Router } = require('express');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');
const { isStaffAdmin } = require('../lib/roles');
const {
  loadOpenwaConfigFromDB,
  isOpenwaConfigured,
  normalizePhone,
  toChatId,
  sendWhatsApp,
  searchMessagesByPhone,
} = require('../lib/openwa');

const router = Router();

function canAccessWhatsApp(user) {
  return isStaffAdmin(user?.rol) || user?.rol === 'terapeuta';
}

/** Unifica @c.us y @s.whatsapp.net; conserva @lid tal cual */
function normalizeChatId(chatId) {
  const raw = String(chatId || '').trim();
  if (!raw) return null;
  if (raw.includes('@lid')) return raw;
  if (raw.includes('@g.us')) return raw;
  const phone = normalizePhone(raw.split('@')[0]);
  return phone ? `${phone}@c.us` : null;
}

function phoneTail(phone) {
  const digits = normalizePhone(phone);
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/** Teléfono real (10-13 dígitos). Los @lid de WhatsApp tienen 14+ dígitos. */
function isWhatsAppPhone(digits) {
  const d = normalizePhone(digits);
  return d.length >= 10 && d.length <= 13;
}

function isLidPhone(digits) {
  const d = normalizePhone(digits);
  return d.length > 13;
}

function resolveWebhookContact(data) {
  const rawChatId = String(data.chatId || '');
  const lidChatId = data.lidChatId || (rawChatId.includes('@lid') ? rawChatId : null);
  const phoneChatId = data.phoneChatId || null;

  let phone = '';
  let chatId = null;

  if (phoneChatId) {
    phone = normalizePhone(phoneChatId.split('@')[0]);
    chatId = normalizeChatId(phoneChatId);
  } else if (rawChatId && !rawChatId.includes('@lid')) {
    phone = normalizePhone(rawChatId.split('@')[0]);
    chatId = normalizeChatId(rawChatId);
  }

  if (phone && !isWhatsAppPhone(phone)) phone = '';
  if (!chatId && lidChatId) chatId = lidChatId;

  return { phone, chatId, lidChatId };
}

async function findConversacionId({ chatId, phone, lidChatId, preferId = null }) {
  const normalizedPhone = phone && isWhatsAppPhone(phone) ? normalizePhone(phone) : '';
  const tail = normalizedPhone ? phoneTail(normalizedPhone) : '';

  if (normalizedPhone) {
    const merged = await mergeConversacionesByPhone(normalizedPhone, preferId);
    if (merged) return merged;
  }

  if (lidChatId) {
    const [byLid] = await pool.execute(
      'SELECT id FROM wa_conversaciones WHERE lid_chat_id = ? OR chat_id = ? LIMIT 1',
      [lidChatId, lidChatId]
    );
    if (byLid.length) return byLid[0].id;

    const [byAwaitLid] = await pool.execute(
      `SELECT id FROM wa_conversaciones
       WHERE awaiting_lid_until > NOW()
       ORDER BY ultimo_mensaje_at DESC, id DESC
       LIMIT 1`
    );
    if (byAwaitLid.length) return byAwaitLid[0].id;
  }

  const normalizedChatId = chatId && !String(chatId).includes('@lid')
    ? normalizeChatId(chatId)
    : chatId;
  if (normalizedChatId) {
    const [byChat] = await pool.execute(
      'SELECT id FROM wa_conversaciones WHERE chat_id = ? LIMIT 1',
      [normalizedChatId]
    );
    if (byChat.length) return byChat[0].id;
  }

  if (tail) {
    const [byTail] = await pool.execute(
      `SELECT id FROM wa_conversaciones
       WHERE LENGTH(REPLACE(phone,'+','')) BETWEEN 10 AND 13
         AND RIGHT(REPLACE(phone,'+',''), 9) = ?
       ORDER BY ultimo_mensaje_at DESC, id DESC LIMIT 1`,
      [tail]
    );
    if (byTail.length) return byTail[0].id;
  }

  return null;
}

/** Une conversaciones @lid huérfanas al chat principal del teléfono */
async function absorbOrphanLidConversations(primaryId) {
  const [[primary]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [primaryId]);
  if (!primary) return primaryId;

  const anchor = primary.ultimo_mensaje_at || primary.updated_at || new Date();
  const [orphans] = await pool.execute(
    `SELECT id, lid_chat_id, chat_id FROM wa_conversaciones
     WHERE id != ?
       AND (chat_id LIKE '%@lid' OR LENGTH(REPLACE(COALESCE(phone,''),'+','')) > 13)
       AND ultimo_mensaje_at >= DATE_SUB(?, INTERVAL 72 HOUR)
       AND ultimo_mensaje_at <= DATE_ADD(?, INTERVAL 72 HOUR)`,
    [primaryId, anchor, anchor]
  );

  for (const o of orphans) {
    await pool.execute(
      'UPDATE wa_mensajes SET conversacion_id = ? WHERE conversacion_id = ?',
      [primaryId, o.id]
    );
    const lid = o.lid_chat_id || (String(o.chat_id || '').includes('@lid') ? o.chat_id : null);
    if (lid) {
      await pool.execute(
        'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
        [lid, primaryId]
      );
    }
    await pool.execute('DELETE FROM wa_conversaciones WHERE id = ?', [o.id]);
  }
  return primaryId;
}

function dedupeMensajes(rows) {
  const seen = new Set();
  return rows.filter((m) => {
    const key = m.wa_message_id ? `wa:${m.wa_message_id}` : `id:${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getRelatedConversacionIds(conv) {
  const ids = new Set([conv.id]);
  const phone = isWhatsAppPhone(conv.phone) ? normalizePhone(conv.phone) : '';
  const tail = phone ? phoneTail(phone) : '';

  if (tail) {
    const [rows] = await pool.execute(
      `SELECT id FROM wa_conversaciones
       WHERE LENGTH(REPLACE(phone,'+','')) BETWEEN 10 AND 13
         AND RIGHT(REPLACE(phone,'+',''), 9) = ?`,
      [tail]
    );
    rows.forEach(r => ids.add(r.id));
  }
  if (conv.lid_chat_id) {
    const [rows] = await pool.execute(
      'SELECT id FROM wa_conversaciones WHERE lid_chat_id = ? OR chat_id = ?',
      [conv.lid_chat_id, conv.lid_chat_id]
    );
    rows.forEach(r => ids.add(r.id));
  }
  return [...ids];
}

async function syncMensajesFromOpenwa(conv, conversacionId) {
  if (!isOpenwaConfigured() || !isWhatsAppPhone(conv.phone)) return;
  try {
    await loadOpenwaConfigFromDB();
    const remote = await searchMessagesByPhone(conv.phone);
    for (const m of remote) {
      const isOut = m.direction === 'outgoing';
      await insertMensaje({
        conversacionId,
        waMessageId: m.wa_message_id || null,
        direccion: isOut ? 'outgoing' : 'incoming',
        tipo: m.type || 'text',
        cuerpo: m.body || '',
        origen: isOut ? 'crm' : 'whatsapp',
        timestamp: m.timestamp || null,
        reassignConversacion: !isOut,
      });
      if (m.chat_id?.includes('@lid')) {
        await pool.execute(
          'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
          [m.chat_id, conversacionId]
        );
      }
    }
  } catch (err) {
    console.error('[whatsapp/sync]', err.message);
  }
}

function authWhatsApp(req, res, next) {
  auth(req, res, () => {
    if (!canAccessWhatsApp(req.user)) {
      return res.status(403).json({ error: 'Acceso restringido' });
    }
    next();
  });
}

async function findPacienteByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const tail = digits.length > 9 ? digits.slice(-9) : digits;
  const [rows] = await pool.execute(
    `SELECT id, nombre, apellido, telefono
     FROM pacientes
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefono,'+',''),' ',''),'-',''),'(','') LIKE ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [`%${tail}`]
  );
  return rows[0] || null;
}

/** Fusiona conversaciones duplicadas del mismo teléfono (ej. @c.us vs @s.whatsapp.net) */
async function mergeConversacionesByPhone(phone, preferId = null) {
  const normalizedPhone = normalizePhone(phone);
  const tail = phoneTail(normalizedPhone);
  if (!normalizedPhone) return null;

  const [rows] = await pool.execute(
    `SELECT id, chat_id, no_leidos, ultimo_mensaje_at
     FROM wa_conversaciones
     WHERE LENGTH(REPLACE(phone,'+','')) BETWEEN 10 AND 13
       AND (phone = ? OR (? <> '' AND RIGHT(REPLACE(phone,'+',''), 9) = ?))
     ORDER BY ultimo_mensaje_at DESC, updated_at DESC, id DESC`,
    [normalizedPhone, tail, tail]
  );
  if (!rows.length) return null;
  if (rows.length === 1) {
    const only = rows[0];
    const canonicalChatId = normalizeChatId(only.chat_id) || only.chat_id;
    const [[conflictOne]] = await pool.execute(
      'SELECT id FROM wa_conversaciones WHERE chat_id = ? AND id != ? LIMIT 1',
      [canonicalChatId, only.id]
    );
    if (!conflictOne) {
      await pool.execute(
        'UPDATE wa_conversaciones SET chat_id = ?, phone = ? WHERE id = ?',
        [canonicalChatId, normalizedPhone, only.id]
      );
    } else {
      await pool.execute(
        'UPDATE wa_conversaciones SET phone = ? WHERE id = ?',
        [normalizedPhone, only.id]
      );
    }
    return only.id;
  }

  const preferred = preferId && rows.some(r => r.id === preferId) ? preferId : null;
  const primaryId = preferred || rows[0].id;
  const canonicalChatId = normalizeChatId(rows[0].chat_id) || rows[0].chat_id;
  let totalUnread = rows[0].no_leidos || 0;

  for (let i = 1; i < rows.length; i++) {
    const dup = rows[i];
    totalUnread += dup.no_leidos || 0;
    await pool.execute(
      'UPDATE wa_mensajes SET conversacion_id = ? WHERE conversacion_id = ?',
      [primaryId, dup.id]
    );
    await pool.execute('DELETE FROM wa_conversaciones WHERE id = ?', [dup.id]);
  }

  const [[conflict]] = await pool.execute(
    'SELECT id FROM wa_conversaciones WHERE chat_id = ? AND id != ? LIMIT 1',
    [canonicalChatId, primaryId]
  );
  if (!conflict) {
    await pool.execute(
      'UPDATE wa_conversaciones SET chat_id = ?, phone = ?, no_leidos = ? WHERE id = ?',
      [canonicalChatId, normalizedPhone, totalUnread, primaryId]
    );
  } else {
    await pool.execute(
      'UPDATE wa_conversaciones SET phone = ?, no_leidos = ? WHERE id = ?',
      [normalizedPhone, totalUnread, primaryId]
    );
  }
  return primaryId;
}

async function upsertConversacion({ chatId, phone, lidChatId, contactName, body, timestamp, incrementUnread }) {
  const rawPhone = phone || (chatId && !String(chatId).includes('@lid') ? chatId.split('@')[0] : '');
  const normalizedPhone = isWhatsAppPhone(rawPhone) ? normalizePhone(rawPhone) : '';
  const normalizedChatId = chatId?.includes('@lid')
    ? null
    : (normalizeChatId(chatId) || chatId);
  const paciente = normalizedPhone ? await findPacienteByPhone(normalizedPhone) : null;
  const ts = timestamp ? new Date(timestamp * 1000) : new Date();

  const existingId = await findConversacionId({
    chatId: normalizedChatId || chatId,
    phone: normalizedPhone,
    lidChatId,
  });

  if (existingId) {
    const [[existingRow]] = await pool.execute(
      'SELECT id, no_leidos, phone, chat_id FROM wa_conversaciones WHERE id = ? LIMIT 1',
      [existingId]
    );
    const noLeidos = incrementUnread ? existingRow.no_leidos + 1 : existingRow.no_leidos;
    const storePhone = normalizedPhone || (isWhatsAppPhone(existingRow.phone) ? existingRow.phone : null);
    const storeChatId = normalizedChatId || existingRow.chat_id;
    await pool.execute(
      `UPDATE wa_conversaciones
       SET chat_id = COALESCE(?, chat_id),
           phone = COALESCE(?, phone),
           lid_chat_id = COALESCE(?, lid_chat_id),
           contact_name = COALESCE(?, contact_name),
           paciente_id = COALESCE(paciente_id, ?),
           ultimo_mensaje = ?,
           ultimo_mensaje_at = ?,
           no_leidos = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        storeChatId, storePhone, lidChatId || null,
        contactName || null, paciente?.id || null,
        body || '', ts, noLeidos, existingRow.id,
      ]
    );
    return existingRow.id;
  }

  const insertChatId = normalizedChatId || lidChatId || toChatId(normalizedPhone);
  const insertPhone = normalizedPhone || null;
  const [r] = await pool.execute(
    `INSERT INTO wa_conversaciones
      (chat_id, phone, lid_chat_id, contact_name, paciente_id, ultimo_mensaje, ultimo_mensaje_at, no_leidos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      insertChatId, insertPhone, lidChatId || null,
      contactName || null, paciente?.id || null,
      body || '', ts, incrementUnread ? 1 : 0,
    ]
  );
  return r.insertId;
}

async function reconcileMensajeDup(row, {
  conversacionId, enviadoPor, origen, cuerpo, direccion, reassignConversacion,
}) {
  const shouldMove = row.conversacion_id !== conversacionId
    && (reassignConversacion || direccion === 'incoming');
  if (shouldMove) {
    await pool.execute(
      `UPDATE wa_mensajes
       SET conversacion_id = ?, enviado_por = COALESCE(?, enviado_por),
           origen = ?, cuerpo = ?, direccion = ?
       WHERE id = ?`,
      [conversacionId, enviadoPor || null, origen || 'whatsapp', cuerpo || '', direccion, row.id]
    );
  } else if (direccion === 'incoming' && cuerpo && !row.cuerpo) {
    await pool.execute('UPDATE wa_mensajes SET cuerpo = ? WHERE id = ?', [cuerpo, row.id]);
  }
  return row.id;
}

async function insertMensaje({
  conversacionId,
  waMessageId,
  direccion,
  tipo,
  cuerpo,
  enviadoPor,
  origen,
  timestamp,
  reassignConversacion = false,
}) {
  if (!waMessageId && direccion === 'outgoing' && cuerpo) {
    const [recent] = await pool.execute(
      `SELECT id FROM wa_mensajes
       WHERE conversacion_id = ? AND direccion = 'outgoing' AND cuerpo = ?
         AND created_at > DATE_SUB(NOW(), INTERVAL 45 SECOND)
       ORDER BY id DESC LIMIT 1`,
      [conversacionId, cuerpo]
    );
    if (recent.length) return recent[0].id;
  }

  if (waMessageId) {
    const [dup] = await pool.execute(
      'SELECT id, conversacion_id, cuerpo FROM wa_mensajes WHERE wa_message_id = ? LIMIT 1',
      [waMessageId]
    );
    if (dup.length) {
      return await reconcileMensajeDup(dup[0], {
        conversacionId, enviadoPor, origen, cuerpo, direccion, reassignConversacion,
      });
    }
  }

  try {
    const [r] = await pool.execute(
      `INSERT INTO wa_mensajes
        (conversacion_id, wa_message_id, direccion, tipo, cuerpo, enviado_por, origen, timestamp_wa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conversacionId,
        waMessageId || null,
        direccion,
        tipo || 'text',
        cuerpo || '',
        enviadoPor || null,
        origen || 'whatsapp',
        timestamp || null,
      ]
    );
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' && waMessageId) {
      const [dup] = await pool.execute(
        'SELECT id, conversacion_id, cuerpo FROM wa_mensajes WHERE wa_message_id = ? LIMIT 1',
        [waMessageId]
      );
      if (dup.length) {
        return await reconcileMensajeDup(dup[0], {
          conversacionId, enviadoPor, origen, cuerpo, direccion, reassignConversacion,
        });
      }
    }
    throw err;
  }
}

// ── Webhook OpenWA (público, autenticado por token) ─────────────
router.post('/webhook', async (req, res) => {
  try {
    await loadOpenwaConfigFromDB();
    const token = process.env.OPENWA_WEBHOOK_TOKEN || '';
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token && bearer !== token) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const { event, data } = req.body || {};
    if (!event || !data) return res.json({ ok: true, skipped: true });

    if (event === 'message:received' || event === 'message:sent') {
      const contact = resolveWebhookContact(data);
      if (!contact.chatId || contact.chatId.includes('@g.us')) {
        return res.json({ ok: true, skipped: true });
      }

      // Salientes del CRM/API ya se guardan en POST /mensajes; solo procesar envíos desde celular
      if (event === 'message:sent' && data.source !== 'phone') {
        return res.json({ ok: true, skipped: true });
      }

      const isIncoming = event === 'message:received';
      const origen = data.source === 'phone' ? 'telefono' : (data.source === 'crm' ? 'crm' : 'whatsapp');

      const conversacionId = await upsertConversacion({
        chatId: contact.chatId,
        phone: contact.phone,
        lidChatId: contact.lidChatId,
        contactName: data.fromName || null,
        body: data.body || data.text || '',
        timestamp: data.timestamp,
        incrementUnread: isIncoming,
      });

      await insertMensaje({
        conversacionId,
        waMessageId: data.messageId || null,
        direccion: isIncoming ? 'incoming' : 'outgoing',
        tipo: data.messageType || 'text',
        cuerpo: data.body || data.text || '',
        origen,
        timestamp: data.timestamp,
        reassignConversacion: isIncoming,
      });

      if (isIncoming) {
        await absorbOrphanLidConversations(conversacionId);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[whatsapp/webhook]', err.message);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// ── Listar conversaciones ───────────────────────────────────────
router.get('/conversaciones', authWhatsApp, async (req, res) => {
  try {
    const estado = req.query.estado;
    let sql = `
      SELECT c.*,
             p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
             t.nombre AS asignado_nombre, t.apellido AS asignado_apellido
      FROM wa_conversaciones c
      LEFT JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN terapeutas t ON t.id = c.asignado_a
      WHERE 1=1`;
    const params = [];
    if (estado) { sql += ' AND c.estado = ?'; params.push(estado); }
    sql += ' ORDER BY c.ultimo_mensaje_at DESC, c.updated_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mensajes de una conversación ────────────────────────────────
router.get('/conversaciones/:id/mensajes', authWhatsApp, async (req, res) => {
  try {
    const [[conv]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    let conversacionId = await mergeConversacionesByPhone(conv.phone, conv.id) || conv.id;
    conversacionId = await absorbOrphanLidConversations(conversacionId);

    if (req.query.sync === '1') {
      const [[merged]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [conversacionId]);
      await syncMensajesFromOpenwa(merged, conversacionId);
      conversacionId = await absorbOrphanLidConversations(conversacionId);
    }

    const [[fresh]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [conversacionId]);
    const relatedIds = await getRelatedConversacionIds(fresh || { ...conv, id: conversacionId });
    const placeholders = relatedIds.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT m.*, t.nombre AS enviado_nombre, t.apellido AS enviado_apellido
       FROM wa_mensajes m
       LEFT JOIN terapeutas t ON t.id = m.enviado_por
       WHERE m.conversacion_id IN (${placeholders})
       ORDER BY COALESCE(m.timestamp_wa, UNIX_TIMESTAMP(m.created_at)) ASC, m.id ASC
       LIMIT 500`,
      relatedIds
    );
    res.json(dedupeMensajes(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Marcar conversación como leída ──────────────────────────────
router.patch('/conversaciones/:id/leer', authWhatsApp, async (req, res) => {
  try {
    await pool.execute('UPDATE wa_conversaciones SET no_leidos = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Enviar mensaje ──────────────────────────────────────────────
router.post('/conversaciones/:id/mensajes', authWhatsApp, async (req, res) => {
  try {
    const { mensaje } = req.body || {};
    const text = String(mensaje || '').trim();
    if (!text) return res.status(400).json({ error: 'Mensaje vacío' });
    if (!isOpenwaConfigured()) return res.status(400).json({ error: 'OpenWA no configurado' });

    const [[conv]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const conversacionId = await mergeConversacionesByPhone(conv.phone, conv.id) || conv.id;
    const destino = isWhatsAppPhone(conv.phone)
      ? (conv.chat_id?.includes('@lid') ? toChatId(conv.phone) : (conv.chat_id || toChatId(conv.phone)))
      : (conv.lid_chat_id || conv.chat_id || toChatId(conv.phone));

    const result = await sendWhatsApp({ to: destino, message: text });
    const ts = Math.floor(Date.now() / 1000);
    const resolvedChatId = result.chatId?.includes('@lid')
      ? null
      : (normalizeChatId(result.chatId || destino) || destino);
    const resolvedLid = result.chatId?.includes('@lid') ? result.chatId : conv.lid_chat_id;
    const resolvedPhone = isWhatsAppPhone(conv.phone)
      ? normalizePhone(conv.phone)
      : normalizePhone(destino.split('@')[0]);

    await pool.execute(
      `UPDATE wa_conversaciones
       SET chat_id = COALESCE(?, chat_id),
           phone = COALESCE(?, phone),
           lid_chat_id = COALESCE(?, lid_chat_id),
           awaiting_lid_until = DATE_ADD(NOW(), INTERVAL 7 DAY),
           ultimo_mensaje = ?, ultimo_mensaje_at = NOW(), no_leidos = 0, updated_at = NOW()
       WHERE id = ?`,
      [resolvedChatId, isWhatsAppPhone(resolvedPhone) ? resolvedPhone : null, resolvedLid, text, conversacionId]
    );

    const msgId = await insertMensaje({
      conversacionId,
      waMessageId: result.messageId || null,
      direccion: 'outgoing',
      tipo: 'text',
      cuerpo: text,
      enviadoPor: req.user.id,
      origen: 'crm',
      timestamp: ts,
      reassignConversacion: true,
    });

    res.status(201).json({ ok: true, id: msgId, conversacionId, messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Estado de integración ───────────────────────────────────────
router.get('/status', authWhatsApp, async (req, res) => {
  try {
    await loadOpenwaConfigFromDB();
    const origin = `${req.protocol}://${req.get('host')}`;
    const mount = (process.env.APP_MOUNT_PATH || '/crm').replace(/\/$/, '');
    res.json({
      configured: isOpenwaConfigured(),
      webhookUrl: `${origin}${mount}/api/whatsapp/webhook`,
      hasWebhookToken: Boolean(process.env.OPENWA_WEBHOOK_TOKEN),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Iniciar chat por teléfono ───────────────────────────────────
router.post('/iniciar', authWhatsApp, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.telefono);
    if (!phone || !isWhatsAppPhone(phone)) {
      return res.status(400).json({ error: 'Teléfono inválido. Usa código de país, ej: 51999999999 o 980858922' });
    }
    const chatId = toChatId(phone);
    const paciente = await findPacienteByPhone(phone);
    const contactName = paciente ? `${paciente.nombre} ${paciente.apellido}`.trim() : null;

    const id = await upsertConversacion({
      chatId,
      phone,
      contactName,
      body: '',
      timestamp: Math.floor(Date.now() / 1000),
      incrementUnread: false,
    });

    await pool.execute(
      'UPDATE wa_conversaciones SET awaiting_lid_until = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?',
      [id]
    );

    const [[conv]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [id]);
    res.status(201).json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
