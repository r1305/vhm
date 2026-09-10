const { Router } = require('express');
const multer = require('multer');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');
const { isStaffAdmin } = require('../lib/roles');
const {
  loadOpenwaConfigFromDB,
  isOpenwaConfigured,
  normalizePhone,
  toChatId,
  sendWhatsApp,
  sendWhatsAppMedia,
  mediaTypeFromMime,
  fetchOpenwaMediaFile,
  fetchOpenwaMediaByMessage,
  downloadOpenwaMedia,
  searchMessagesByPhone,
  getSessionMessagesByPhone,
  getChatMessages,
  resolveLidPhone,
  resolvePhoneJid,
  markChatRead,
} = require('../lib/openwa');
const {
  normalizeChatId,
  isWhatsAppPhone,
  phoneTail,
  resolveChatJidForConv,
} = require('../lib/waChatJid');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function respondRouteError(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.message, code: err.code || undefined });
}

const MEDIA_LABELS = {
  image: '🖼️ Imagen',
  audio: '🎵 Audio',
  video: '🎬 Video',
  document: '📄 Documento',
};

function mediaBodyLabel(tipo, cuerpo) {
  const t = String(tipo || 'text');
  const body = String(cuerpo || '').trim();
  if (body && !Object.values(MEDIA_LABELS).includes(body)) return body;
  return MEDIA_LABELS[t] || body || '';
}

function guessMediaMime(tipo) {
  if (tipo === 'image') return 'image/jpeg';
  if (tipo === 'video') return 'video/mp4';
  if (tipo === 'audio') return 'audio/ogg';
  return 'application/octet-stream';
}

function mapAckStatus(status) {
  const n = typeof status === 'number' ? status : Number(status);
  if (Number.isFinite(n)) {
    if (n >= 4) return 'read';
    if (n === 3) return 'delivered';
    if (n === 2) return 'sent';
    return 'pending';
  }
  const s = String(status || '').toLowerCase();
  if (s.includes('read') || s.includes('played')) return 'read';
  if (s.includes('deliver')) return 'delivered';
  return 'sent';
}

const router = Router();

function canAccessWhatsApp(user) {
  return isStaffAdmin(user?.rol) || user?.rol === 'terapeuta';
}

function isLidPhone(digits) {
  const d = normalizePhone(digits);
  return d.length > 13;
}

function resolveWebhookContact(data) {
  const rawChatId = String(data.chatId || '');
  const remoteJid = data.remoteJid && String(data.remoteJid).includes('@') ? String(data.remoteJid) : null;
  const fromJid = data.from && String(data.from).includes('@') ? String(data.from) : null;
  let lidChatId = data.lidChatId
    || (remoteJid?.includes('@lid') ? remoteJid : null)
    || (rawChatId.includes('@lid') ? rawChatId : null);
  if (!lidChatId && fromJid?.includes('@lid')) lidChatId = fromJid;
  const phoneChatId = data.phoneChatId || null;

  let phone = '';
  let chatId = null;

  if (phoneChatId) {
    phone = normalizePhone(phoneChatId.split('@')[0]);
    chatId = normalizeChatId(phoneChatId);
  } else if (rawChatId && !rawChatId.includes('@lid')) {
    phone = normalizePhone(rawChatId.split('@')[0]);
    chatId = normalizeChatId(rawChatId);
  } else if (remoteJid && !remoteJid.includes('@lid')) {
    phone = normalizePhone(remoteJid.split('@')[0]);
    chatId = normalizeChatId(remoteJid);
  } else if (fromJid && !fromJid.includes('@lid')) {
    phone = normalizePhone(fromJid.split('@')[0]);
    chatId = normalizeChatId(fromJid);
  }

  if (phone && !isWhatsAppPhone(phone)) phone = '';
  if (!chatId && lidChatId) chatId = lidChatId;

  return { phone, chatId, lidChatId };
}

/** Asocia un @lid entrante con la conversación de teléfono que acaba de escribirle el CRM */
async function findConversationForLidInbound(lidChatId) {
  if (!lidChatId || !String(lidChatId).includes('@lid')) return null;

  const [awaiting] = await pool.execute(
    `SELECT id FROM wa_conversaciones
     WHERE awaiting_lid_until IS NOT NULL AND awaiting_lid_until > NOW()
       AND phone IS NOT NULL AND LENGTH(REPLACE(phone,'+','')) >= 10
       AND (lid_chat_id IS NULL OR lid_chat_id = ?)
     ORDER BY
       CASE WHEN lid_chat_id = ? THEN 0 ELSE 1 END,
       ultimo_mensaje_at DESC,
       updated_at DESC
     LIMIT 1`,
    [lidChatId, lidChatId]
  );
  if (awaiting.length) return awaiting[0].id;

  const [openAwaiting] = await pool.execute(
    `SELECT id FROM wa_conversaciones
     WHERE awaiting_lid_until > NOW()
       AND phone IS NOT NULL AND lid_chat_id IS NULL
     ORDER BY ultimo_mensaje_at DESC`
  );
  if (openAwaiting.length === 1) return openAwaiting[0].id;

  return null;
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

    const mappedPhone = await resolveLidPhone(lidChatId);
    if (mappedPhone && isWhatsAppPhone(mappedPhone)) {
      const merged = await mergeConversacionesByPhone(mappedPhone, preferId);
      if (merged) return merged;
    }

    const awaitingId = await findConversationForLidInbound(lidChatId);
    if (awaitingId) return awaitingId;
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

/** Une conversaciones @lid huérfanas con el chat principal (mismo teléfono/LID) */
async function absorbOrphanLidConversations(primaryId) {
  const [[primary]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [primaryId]);
  if (!primary) return primaryId;

  if (!isWhatsAppPhone(primary.phone)) {
    const orphanLid = primary.lid_chat_id || (String(primary.chat_id).includes('@lid') ? primary.chat_id : null);
    if (orphanLid) {
      const mapped = await resolveLidPhone(orphanLid);
      if (mapped && isWhatsAppPhone(mapped)) {
        const targetId = await mergeConversacionesByPhone(mapped, null);
        if (targetId && targetId !== primaryId) {
          await pool.execute(
            'UPDATE wa_mensajes SET conversacion_id = ? WHERE conversacion_id = ?',
            [targetId, primaryId]
          );
          await pool.execute(
            `UPDATE wa_conversaciones
             SET lid_chat_id = COALESCE(lid_chat_id, ?),
                 awaiting_lid_until = COALESCE(awaiting_lid_until, DATE_ADD(NOW(), INTERVAL 2 HOUR))
             WHERE id = ?`,
            [orphanLid, targetId]
          );
          await pool.execute('DELETE FROM wa_conversaciones WHERE id = ?', [primaryId]);
          return absorbOrphanLidConversations(targetId);
        }
      }
    }
  }

  let lid = primary.lid_chat_id || (String(primary.chat_id).includes('@lid') ? primary.chat_id : null);

  if (isWhatsAppPhone(primary.phone) && primary.awaiting_lid_until
    && new Date(primary.awaiting_lid_until) > new Date()) {
    const [orphans] = await pool.execute(
      `SELECT id, chat_id, lid_chat_id FROM wa_conversaciones
       WHERE id != ? AND chat_id LIKE '%@lid'
         AND (phone IS NULL OR phone = '')
         AND ultimo_mensaje_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)`,
      [primaryId]
    );
    const eligible = orphans.filter((o) => {
      const oLid = o.lid_chat_id || o.chat_id;
      return !lid || oLid === lid;
    });
    if (eligible.length === 1) {
      const o = eligible[0];
      const oLid = o.lid_chat_id || o.chat_id;
      await pool.execute(
        'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
        [oLid, primaryId]
      );
      await pool.execute(
        'UPDATE wa_mensajes SET conversacion_id = ? WHERE conversacion_id = ?',
        [primaryId, o.id]
      );
      await pool.execute('DELETE FROM wa_conversaciones WHERE id = ?', [o.id]);
      if (!lid) lid = oLid;
    }
  }

  if (lid) {
    await pool.execute(
      'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
      [lid, primaryId]
    );
    const [orphans] = await pool.execute(
      `SELECT id FROM wa_conversaciones
       WHERE id != ? AND (lid_chat_id = ? OR chat_id = ?)`,
      [primaryId, lid, lid]
    );
    for (const o of orphans) {
      await pool.execute(
        'UPDATE wa_mensajes SET conversacion_id = ? WHERE conversacion_id = ?',
        [primaryId, o.id]
      );
      await pool.execute('DELETE FROM wa_conversaciones WHERE id = ?', [o.id]);
    }
  }

  if (isWhatsAppPhone(primary.phone)) {
    const tail = phoneTail(primary.phone);
    const [candidates] = await pool.execute(
      `SELECT id, chat_id, lid_chat_id, phone FROM wa_conversaciones
       WHERE id != ?
         AND (chat_id LIKE '%@lid' OR lid_chat_id IS NOT NULL)`,
      [primaryId]
    );
    for (const o of candidates) {
      const oLid = o.lid_chat_id || (String(o.chat_id).includes('@lid') ? o.chat_id : null);
      if (!oLid) continue;
      let matches = false;
      if (o.phone && isWhatsAppPhone(o.phone) && phoneTail(o.phone) === tail) {
        matches = true;
      } else {
        const mapped = await resolveLidPhone(oLid);
        if (mapped && phoneTail(mapped) === tail) matches = true;
      }
      if (!matches) continue;
      await pool.execute(
        'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
        [oLid, primaryId]
      );
      await pool.execute(
        'UPDATE wa_mensajes SET conversacion_id = ? WHERE conversacion_id = ?',
        [primaryId, o.id]
      );
      await pool.execute('DELETE FROM wa_conversaciones WHERE id = ?', [o.id]);
      if (!lid) lid = oLid;
    }
  }

  return primaryId;
}

function isLikelyWaMessageId(id) {
  const s = String(id || '').trim();
  if (!s) return false;
  if (/^\d{1,8}$/.test(s)) return false;
  return s.length >= 8;
}

function dedupeMensajes(rows) {
  const seenWa = new Set();
  const seenContent = new Set();
  return rows.filter((m) => {
    if (m.wa_message_id && isLikelyWaMessageId(m.wa_message_id)) {
      const k = `wa:${m.wa_message_id}`;
      if (seenWa.has(k)) return false;
      seenWa.add(k);
      return true;
    }
    const ts = m.timestamp_wa || Math.floor(new Date(m.created_at).getTime() / 1000);
    const bucket = Math.floor(ts / 3);
    const ck = `${m.direccion}:${m.cuerpo}:${bucket}`;
    if (seenContent.has(ck)) return false;
    seenContent.add(ck);
    return true;
  });
}

/** Fusiona conversaciones duplicadas del mismo teléfono (sidebar y webhooks) */
async function dedupeAllConversaciones() {
  const [tails] = await pool.execute(
    `SELECT RIGHT(REPLACE(phone,'+',''), 9) AS tail
     FROM wa_conversaciones
     WHERE phone IS NOT NULL AND LENGTH(REPLACE(phone,'+','')) BETWEEN 10 AND 13
     GROUP BY tail
     HAVING COUNT(*) > 1`
  );
  for (const { tail } of tails) {
    const [sample] = await pool.execute(
      `SELECT phone FROM wa_conversaciones
       WHERE RIGHT(REPLACE(phone,'+',''), 9) = ?
         AND LENGTH(REPLACE(phone,'+','')) BETWEEN 10 AND 13
       ORDER BY ultimo_mensaje_at DESC, id DESC
       LIMIT 1`,
      [tail]
    );
    if (sample[0]?.phone) await mergeConversacionesByPhone(sample[0].phone);
  }

  const [lidRows] = await pool.execute(
    `SELECT id, chat_id, lid_chat_id FROM wa_conversaciones
     WHERE lid_chat_id IS NOT NULL OR chat_id LIKE '%@lid'`
  );
  for (const row of lidRows) {
    const lid = row.lid_chat_id || (String(row.chat_id).includes('@lid') ? row.chat_id : null);
    if (!lid) continue;
    const mapped = await resolveLidPhone(lid);
    if (mapped && isWhatsAppPhone(mapped)) {
      await mergeConversacionesByPhone(mapped, row.id);
    }
  }

  const [awaitingRows] = await pool.execute(
    `SELECT id FROM wa_conversaciones
     WHERE awaiting_lid_until > NOW() AND phone IS NOT NULL`
  );
  for (const row of awaitingRows) {
    await absorbOrphanLidConversations(row.id);
  }
}

async function hasRecentOutgoingCrm({ phone, cuerpo, waMessageId }) {
  if (waMessageId) {
    const [byId] = await pool.execute(
      'SELECT id FROM wa_mensajes WHERE wa_message_id = ? LIMIT 1',
      [waMessageId]
    );
    if (byId.length) return true;
  }
  if (!cuerpo || !phone || !isWhatsAppPhone(phone)) return false;
  const normalized = normalizePhone(phone);
  const tail = phoneTail(normalized);
  const [recent] = await pool.execute(
    `SELECT m.id FROM wa_mensajes m
     INNER JOIN wa_conversaciones c ON c.id = m.conversacion_id
     WHERE m.direccion = 'outgoing' AND m.cuerpo = ?
       AND (c.phone = ? OR RIGHT(REPLACE(c.phone,'+',''), 9) = ?)
       AND m.created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
     LIMIT 1`,
    [cuerpo, normalized, tail]
  );
  return recent.length > 0;
}

async function getRelatedConversacionIds(conv) {
  const ids = new Set([conv.id]);
  const tail = isWhatsAppPhone(conv.phone) ? phoneTail(conv.phone) : '';
  const lid = conv.lid_chat_id || (String(conv.chat_id).includes('@lid') ? conv.chat_id : null);

  if (tail) {
    const [byPhone] = await pool.execute(
      `SELECT id FROM wa_conversaciones
       WHERE LENGTH(REPLACE(REPLACE(phone,'+',''),' ','')) BETWEEN 10 AND 13
         AND RIGHT(REPLACE(REPLACE(phone,'+',''),' ',''), 9) = ?`,
      [tail]
    );
    byPhone.forEach((r) => ids.add(r.id));
  }

  if (lid) {
    const [byLid] = await pool.execute(
      'SELECT id FROM wa_conversaciones WHERE lid_chat_id = ? OR chat_id = ?',
      [lid, lid]
    );
    byLid.forEach((r) => ids.add(r.id));
  }

  if (tail) {
    const [lidOrphans] = await pool.execute(
      `SELECT id, chat_id, lid_chat_id FROM wa_conversaciones
       WHERE id != ? AND (chat_id LIKE '%@lid' OR lid_chat_id IS NOT NULL)
         AND ultimo_mensaje_at > DATE_SUB(NOW(), INTERVAL 48 HOUR)`,
      [conv.id]
    );
    for (const o of lidOrphans) {
      const oLid = o.lid_chat_id || (String(o.chat_id).includes('@lid') ? o.chat_id : null);
      if (!oLid) continue;
      if (lid && oLid !== lid) continue;
      const mapped = await resolveLidPhone(oLid);
      if (mapped && phoneTail(mapped) === tail) {
        ids.add(o.id);
        continue;
      }
      if (!lid && conv.awaiting_lid_until && new Date(conv.awaiting_lid_until) > new Date()) {
        ids.add(o.id);
      }
    }
  }

  return [...ids];
}

function normalizeOpenwaRow(m) {
  if (!m) return null;
  let ts = m.timestamp;
  if (ts && typeof ts !== 'number') {
    const parsed = Math.floor(new Date(ts).getTime() / 1000);
    ts = Number.isFinite(parsed) ? parsed : null;
  }
  const direction = m.direction || (m.fromMe ? 'outgoing' : 'incoming');
  const rawId = m.wa_message_id || m.messageId || null;
  return {
    wa_message_id: rawId || (isLikelyWaMessageId(m.id) ? m.id : null),
    chat_id: m.chat_id || null,
    body: m.body || m.text || '',
    type: m.type || 'text',
    direction,
    timestamp: ts || null,
    media_path: m.media_path || null,
  };
}

function messageMatchesContact(row, conv, tail) {
  const chatId = String(row.chat_id || '');
  if (conv.lid_chat_id && chatId === conv.lid_chat_id) return true;
  if (conv.chat_id && chatId === conv.chat_id) return true;
  if (conv.chat_id && !chatId.includes('@lid')) {
    const a = normalizeChatId(chatId);
    const b = normalizeChatId(conv.chat_id);
    if (a && b && a === b) return true;
  }
  if (chatId.includes('@lid')) {
    // Mensajes @lid devueltos por búsqueda por teléfono en OpenWA
    return Boolean(tail);
  }
  if (!tail) return false;
  const digits = chatId.split('@')[0].replace(/\D/g, '');
  if (digits.length >= 10 && digits.slice(-9) === tail) return true;
  return false;
}

async function syncMensajesFromOpenwa(conv, conversacionId) {
  if (!isOpenwaConfigured()) return;
  await loadOpenwaConfigFromDB();
  const sessionId = process.env.OPENWA_SESSION || '';
  const tail = isWhatsAppPhone(conv.phone) ? phoneTail(conv.phone) : '';
  const collected = new Map();

  const collect = (raw) => {
    const row = normalizeOpenwaRow(raw);
    if (!row || !messageMatchesContact(row, conv, tail)) return;
    const key = row.wa_message_id
      ? `wa:${row.wa_message_id}`
      : `t:${row.timestamp}:${row.direction}:${row.body}`;
    if (!collected.has(key)) collected.set(key, row);
  };

  const sources = [
    () => searchMessagesByPhone(conv.phone, sessionId).catch(() => []),
    () => conv.lid_chat_id ? getChatMessages(conv.lid_chat_id, sessionId).catch(() => []) : Promise.resolve([]),
  ];

  for (const load of sources) {
    try {
      const rows = await load();
      (rows || []).forEach(collect);
    } catch (err) {
      console.error('[whatsapp/sync]', err.message);
    }
  }

  for (const row of collected.values()) {
    if (row.direction === 'outgoing') {
      if (row.wa_message_id) {
        const [exists] = await pool.execute(
          'SELECT id FROM wa_mensajes WHERE wa_message_id = ? LIMIT 1',
          [row.wa_message_id]
        );
        if (exists.length) continue;
      }
      await insertMensaje({
        conversacionId,
        waMessageId: row.wa_message_id,
        direccion: 'outgoing',
        tipo: row.type || 'text',
        cuerpo: row.body || '',
        origen: 'telefono',
        timestamp: row.timestamp,
        mediaPath: row.media_path || null,
        reassignConversacion: true,
      });
      continue;
    }
    if (row.wa_message_id && row.media_path) {
      await pool.execute(
        `UPDATE wa_mensajes SET media_path = COALESCE(media_path, ?), tipo = ?
         WHERE wa_message_id = ?`,
        [row.media_path, row.type || 'text', row.wa_message_id]
      );
    }
    await insertMensaje({
      conversacionId,
      waMessageId: row.wa_message_id,
      direccion: 'incoming',
      tipo: row.type || 'text',
      cuerpo: row.body || '',
      origen: 'whatsapp',
      timestamp: row.timestamp,
      mediaPath: row.media_path || null,
      reassignConversacion: false,
    });
    if (row.chat_id?.includes('@lid') && conv.lid_chat_id === row.chat_id) {
      await pool.execute(
        'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
        [row.chat_id, conversacionId]
      );
    } else if (row.chat_id?.includes('@lid') && !conv.lid_chat_id) {
      const mappedPhone = await resolveLidPhone(row.chat_id);
      const convPhone = isWhatsAppPhone(conv.phone) ? normalizePhone(conv.phone) : '';
      if (mappedPhone && convPhone && phoneTail(mappedPhone) === phoneTail(convPhone)) {
        await pool.execute(
          'UPDATE wa_conversaciones SET lid_chat_id = ? WHERE id = ?',
          [row.chat_id, conversacionId]
        );
      }
    }
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
    `SELECT id, chat_id, no_leidos, ultimo_mensaje_at, paciente_id
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
  const withPaciente = rows.find(r => r.paciente_id);
  const primaryId = preferred || (withPaciente?.id) || rows[0].id;
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
  mediaPath,
  mediaMime,
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

  if (!waMessageId && direccion === 'incoming' && cuerpo) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const [recentIn] = await pool.execute(
      `SELECT id FROM wa_mensajes
       WHERE conversacion_id = ? AND direccion = 'incoming' AND cuerpo = ?
         AND ABS(COALESCE(timestamp_wa, UNIX_TIMESTAMP(created_at)) - ?) <= 5
       ORDER BY id DESC LIMIT 1`,
      [conversacionId, cuerpo, ts]
    );
    if (recentIn.length) return recentIn[0].id;
  }

  if (waMessageId && isLikelyWaMessageId(waMessageId)) {
    const [dup] = await pool.execute(
      'SELECT id, conversacion_id, cuerpo FROM wa_mensajes WHERE wa_message_id = ? LIMIT 1',
      [waMessageId]
    );
    if (dup.length) {
      if (mediaPath) {
        await pool.execute(
          'UPDATE wa_mensajes SET media_path = COALESCE(media_path, ?), media_mime = COALESCE(media_mime, ?) WHERE id = ?',
          [mediaPath, mediaMime || null, dup[0].id]
        );
      }
      return await reconcileMensajeDup(dup[0], {
        conversacionId, enviadoPor, origen, cuerpo, direccion, reassignConversacion,
      });
    }
  }

  const storeWaId = waMessageId && isLikelyWaMessageId(waMessageId) ? waMessageId : null;
  const ackStatus = direccion === 'outgoing' ? 'sent' : null;

  try {
    const [r] = await pool.execute(
      `INSERT INTO wa_mensajes
        (conversacion_id, wa_message_id, direccion, tipo, cuerpo, enviado_por, origen, timestamp_wa, ack_status, media_path, media_mime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conversacionId,
        storeWaId,
        direccion,
        tipo || 'text',
        cuerpo || '',
        enviadoPor || null,
        origen || 'whatsapp',
        timestamp || null,
        ackStatus,
        mediaPath || null,
        mediaMime || null,
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
      console.warn('[whatsapp/webhook] token rechazado — verifica OPENWA_WEBHOOK_TOKEN en Integraciones y en OpenWA');
      return res.status(401).json({ error: 'Token inválido' });
    }

    const { event, data } = req.body || {};
    if (!event || !data) return res.json({ ok: true, skipped: true });

    if (event === 'message:ack') {
      const ack = mapAckStatus(data.status ?? data.ack);
      if (data.messageId) {
        await pool.execute(
          `UPDATE wa_mensajes SET ack_status = ?
           WHERE wa_message_id = ? AND direccion = 'outgoing'`,
          [ack, data.messageId]
        );
      }
      return res.json({ ok: true });
    }

    if (event === 'message:received' || event === 'message:sent') {
      const contact = resolveWebhookContact(data);
      const effectiveChatId = contact.chatId || contact.lidChatId;
      if (!effectiveChatId || effectiveChatId.includes('@g.us')) {
        return res.json({ ok: true, skipped: true });
      }

      const isIncoming = event === 'message:received';

      // Salientes: el CRM ya guarda en POST /mensajes; evitar duplicado por webhook/upsert
      if (!isIncoming) {
        const skipSent = await hasRecentOutgoingCrm({
          phone: contact.phone,
          cuerpo: data.body || data.text || '',
          waMessageId: data.messageId || null,
        });
        if (skipSent || data.source === 'crm') {
          return res.json({ ok: true, skipped: true });
        }
      }
      const origen = data.source === 'phone' ? 'telefono' : (data.source === 'crm' ? 'crm' : 'whatsapp');

      let phone = contact.phone;
      const lidChatId = contact.lidChatId;
      if (!phone && lidChatId) {
        const mapped = await resolveLidPhone(lidChatId);
        if (mapped && isWhatsAppPhone(mapped)) phone = mapped;
      }

      let conversacionId = await upsertConversacion({
        chatId: effectiveChatId,
        phone,
        lidChatId,
        contactName: data.fromName || null,
        body: data.body || data.text || '',
        timestamp: data.timestamp,
        incrementUnread: isIncoming,
      });

      if (phone) {
        conversacionId = await mergeConversacionesByPhone(phone, conversacionId) || conversacionId;
      }
      conversacionId = await absorbOrphanLidConversations(conversacionId);

      if (lidChatId) {
        await pool.execute(
          'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?), awaiting_lid_until = NULL WHERE id = ?',
          [lidChatId, conversacionId]
        );
      }

      const mediaPath = data.mediaPath || data.media_path || null;
      const msgTipo = data.messageType || 'text';
      await insertMensaje({
        conversacionId,
        waMessageId: data.messageId || null,
        direccion: isIncoming ? 'incoming' : 'outgoing',
        tipo: msgTipo,
        cuerpo: mediaBodyLabel(msgTipo, data.body || data.text || ''),
        origen,
        timestamp: data.timestamp,
        mediaPath,
        reassignConversacion: isIncoming,
      });
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
    await dedupeAllConversaciones();
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

    const [[merged]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [conversacionId]);
    await syncMensajesFromOpenwa(merged, conversacionId);
    conversacionId = await absorbOrphanLidConversations(conversacionId);

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
    res.json({
      conversacionId,
      mensajes: dedupeMensajes(rows),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Marcar conversación como leída ──────────────────────────────
router.patch('/conversaciones/:id/leer', authWhatsApp, async (req, res) => {
  try {
    const [[conv]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const conversacionId = await mergeConversacionesByPhone(conv.phone, conv.id) || conv.id;
    const [[fresh]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [conversacionId]);

    if (isOpenwaConfigured()) {
      const chatJid = resolveChatJidForConv(fresh || conv);
      const [incoming] = await pool.execute(
        `SELECT wa_message_id FROM wa_mensajes
         WHERE conversacion_id = ? AND direccion = 'incoming'
           AND wa_leido = 0 AND wa_message_id IS NOT NULL
         ORDER BY id ASC LIMIT 40`,
        [conversacionId]
      );
      if (chatJid && incoming.length) {
        try {
          await markChatRead({
            chatId: chatJid,
            messageIds: incoming.map(r => r.wa_message_id),
          });
        } catch (err) {
          console.error('[whatsapp/leer]', err.message);
        }
      }
      await pool.execute(
        'UPDATE wa_mensajes SET wa_leido = 1 WHERE conversacion_id = ? AND direccion = ?',
        [conversacionId, 'incoming']
      );
    }

    await pool.execute('UPDATE wa_conversaciones SET no_leidos = 0 WHERE id = ?', [conversacionId]);
    res.json({ ok: true, conversacionId });
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
    const destino = resolveChatJidForConv(conv);

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
           awaiting_lid_until = DATE_ADD(NOW(), INTERVAL 2 HOUR),
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
    respondRouteError(res, err);
  }
});

// ── Enviar imagen / video / audio / documento ───────────────────
router.post('/conversaciones/:id/mensajes/media', authWhatsApp, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    if (!isOpenwaConfigured()) return res.status(400).json({ error: 'OpenWA no configurado' });

    const [[conv]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const conversacionId = await mergeConversacionesByPhone(conv.phone, conv.id) || conv.id;
    const destino = resolveChatJidForConv(conv);
    const caption = String(req.body?.caption || '').trim();
    const duration = req.body?.duration;

    const result = await sendWhatsAppMedia({
      to: destino,
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      caption,
      duration,
    });

    const tipo = result.tipo || mediaTypeFromMime(req.file.mimetype);
    const cuerpo = mediaBodyLabel(tipo, caption);
    const ts = Math.floor(Date.now() / 1000);
    const resolvedLid = result.chatId?.includes('@lid') ? result.chatId : conv.lid_chat_id;
    const resolvedChatId = result.chatId?.includes('@lid')
      ? null
      : (normalizeChatId(result.chatId || destino) || destino);

    await pool.execute(
      `UPDATE wa_conversaciones
       SET chat_id = COALESCE(?, chat_id),
           lid_chat_id = COALESCE(?, lid_chat_id),
           awaiting_lid_until = DATE_ADD(NOW(), INTERVAL 2 HOUR),
           ultimo_mensaje = ?, ultimo_mensaje_at = NOW(), no_leidos = 0, updated_at = NOW()
       WHERE id = ?`,
      [resolvedChatId, resolvedLid, cuerpo, conversacionId]
    );

    const msgId = await insertMensaje({
      conversacionId,
      waMessageId: result.messageId || null,
      direccion: 'outgoing',
      tipo,
      cuerpo,
      enviadoPor: req.user.id,
      origen: 'crm',
      timestamp: ts,
      mediaPath: result.mediaPath || null,
      mediaMime: req.file.mimetype,
      reassignConversacion: true,
    });

    res.status(201).json({ ok: true, id: msgId, conversacionId, messageId: result.messageId, tipo });
  } catch (err) {
    respondRouteError(res, err);
  }
});

async function proxyOpenwaMedia(upstream, res, mime) {
  if (!upstream?.ok) return false;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
  return true;
}

function collectMediaChatJids(msg) {
  const jids = new Set();
  const add = (j) => { if (j) jids.add(String(j)); };
  add(msg.lid_chat_id);
  if (msg.chat_id?.includes('@lid')) add(msg.chat_id);
  add(normalizeChatId(msg.chat_id));
  add(toChatId(msg.phone));
  return [...jids];
}

// ── Servir medio (proxy OpenWA) ───────────────────────────────────
router.get('/mensajes/:id/media', authWhatsApp, async (req, res) => {
  try {
    const [[msg]] = await pool.execute(
      `SELECT m.*, c.chat_id, c.lid_chat_id, c.phone
       FROM wa_mensajes m
       INNER JOIN wa_conversaciones c ON c.id = m.conversacion_id
       WHERE m.id = ?`,
      [req.params.id]
    );
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
    if (!isOpenwaConfigured()) return res.status(400).json({ error: 'OpenWA no configurado' });

    await loadOpenwaConfigFromDB();
    const sessionId = process.env.OPENWA_SESSION || '';
    const mime = msg.media_mime || guessMediaMime(msg.tipo);
    const chatJids = collectMediaChatJids(msg);

    if (msg.wa_message_id) {
      for (const chatJid of chatJids) {
        try {
          const upstream = await fetchOpenwaMediaByMessage(sessionId, msg.wa_message_id, chatJid);
          if (await proxyOpenwaMedia(upstream, res, mime)) return;
        } catch (_) {}
      }
    }

    if (msg.media_path) {
      const filename = String(msg.media_path).split('/').pop();
      try {
        const upstream = await fetchOpenwaMediaFile(sessionId, filename);
        if (await proxyOpenwaMedia(upstream, res, mime)) return;
      } catch (_) {}
    }

    if (msg.wa_message_id) {
      for (const chatJid of chatJids) {
        try {
          const upstream = await downloadOpenwaMedia({
            sessionId,
            messageId: msg.wa_message_id,
            chatId: chatJid,
          });
          if (await proxyOpenwaMedia(upstream, res, mime)) return;
        } catch (_) {}
      }
    }

    return res.status(404).json({ error: 'Medio no disponible' });
  } catch (err) {
    console.error('[whatsapp/media]', req.params.id, err.message);
    return res.status(404).json({ error: 'Medio no disponible' });
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

    const rawName = String(req.body?.nombre || '').trim();
    const id = await upsertConversacion({
      chatId,
      phone,
      contactName: rawName || contactName,
      body: '',
      timestamp: Math.floor(Date.now() / 1000),
      incrementUnread: false,
    });

    let conversacionId = await mergeConversacionesByPhone(phone, id) || id;

    if (isOpenwaConfigured()) {
      try {
        const jid = await resolvePhoneJid(phone);
        if (jid?.includes('@lid')) {
          await pool.execute(
            'UPDATE wa_conversaciones SET lid_chat_id = COALESCE(lid_chat_id, ?) WHERE id = ?',
            [jid, conversacionId]
          );
        }
      } catch (err) {
        console.warn('[whatsapp/iniciar] resolve jid:', err.message);
      }
    }

    conversacionId = await absorbOrphanLidConversations(conversacionId);

    await pool.execute(
      'UPDATE wa_conversaciones SET awaiting_lid_until = DATE_ADD(NOW(), INTERVAL 2 HOUR) WHERE id = ?',
      [conversacionId]
    );

    const [[conv]] = await pool.execute('SELECT * FROM wa_conversaciones WHERE id = ?', [conversacionId]);
    res.status(201).json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
