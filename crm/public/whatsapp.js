/* VHM CRM — Central WhatsApp */
(function () {
  'use strict';

  const { api, toast, esc, openModal, closeModal, fmtTime } = window.CRM;
  const API_BASE = `${window.__APP_BASE__ || ''}/api`;

  let conversaciones = [];
  let selectedId = null;
  let pollTimer = null;
  let sending = false;
  let recording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStartedAt = 0;

  function isRealPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    return d.length >= 10 && d.length <= 13;
  }

  function displayName(c) {
    if (c.paciente_nombre) return `${c.paciente_nombre} ${c.paciente_apellido || ''}`.trim();
    if (c.contact_name) return c.contact_name;
    if (isRealPhone(c.phone)) return c.phone;
    return 'Contacto WhatsApp';
  }

  function mediaUrl(msgId) {
    return `${API_BASE}/whatsapp/mensajes/${msgId}/media`;
  }

  function isMediaTipo(tipo) {
    return ['image', 'video', 'audio', 'document'].includes(String(tipo || ''));
  }

  function isPlaceholderBody(body, tipo) {
    const b = String(body || '').trim();
    const placeholders = ['🖼️ Imagen', '🎵 Audio', '🎬 Video', '📄 Documento', 'Sticker'];
    return placeholders.includes(b) || (isMediaTipo(tipo) && !b);
  }

  function hasMediaSource(m) {
    return Boolean(m.media_path || m.wa_message_id);
  }

  function mediaPlaceholder(tipo, cuerpo) {
    const labels = { image: '🖼️ Imagen', audio: '🎵 Audio', video: '🎬 Video', document: '📄 Documento' };
    return `<span class="wa-msg-placeholder">${esc(cuerpo || labels[tipo] || 'Medio')}</span>`;
  }

  function renderMessageBody(m) {
    const tipo = m.tipo || 'text';
    if (!isMediaTipo(tipo)) return esc(m.cuerpo || '');
    if (!hasMediaSource(m)) return mediaPlaceholder(tipo, m.cuerpo);

    const url = mediaUrl(m.id);
    const cap = !isPlaceholderBody(m.cuerpo, tipo) ? `<div class="wa-msg-caption">${esc(m.cuerpo)}</div>` : '';

    const fail = "this.onerror=null;this.outerHTML='<span class=\\'wa-msg-placeholder\\'>Medio no disponible</span>'";

    if (tipo === 'image') {
      return `<a href="${url}" target="_blank" rel="noopener"><img class="wa-msg-media wa-msg-img" src="${url}" alt="Imagen" loading="lazy" onerror="${fail}"></a>${cap}`;
    }
    if (tipo === 'video') {
      return `<video class="wa-msg-media wa-msg-video" src="${url}" controls preload="metadata" onerror="${fail}"></video>${cap}`;
    }
    if (tipo === 'audio') {
      return `<audio class="wa-msg-audio" controls preload="metadata" src="${url}" onerror="${fail}"></audio>${cap}`;
    }
    if (tipo === 'document') {
      const label = !isPlaceholderBody(m.cuerpo, tipo) ? esc(m.cuerpo) : 'Descargar documento';
      return `<a class="wa-msg-doc" href="${url}" target="_blank" rel="noopener"><i class="fas fa-file"></i> ${label}</a>`;
    }
    return esc(m.cuerpo || '');
  }

  function renderList(filter = '') {
    const list = document.getElementById('waChatList');
    const q = filter.toLowerCase();
    const items = q
      ? conversaciones.filter(c => displayName(c).toLowerCase().includes(q) || (c.phone || '').includes(q))
      : conversaciones;

    if (!items.length) {
      list.innerHTML = '<div class="wa-empty">No hay conversaciones</div>';
      return;
    }

    list.innerHTML = items.map(c => {
      const name = esc(displayName(c));
      const initial = name.charAt(0).toUpperCase();
      const preview = esc((c.ultimo_mensaje || '').slice(0, 60));
      const active = selectedId === c.id ? 'active' : '';
      const unread = c.no_leidos > 0 ? `<span class="wa-unread">${c.no_leidos}</span>` : '';
      return `<div class="wa-chat-item ${active}" data-id="${c.id}">
        <div class="wa-avatar">${initial}</div>
        <div class="wa-chat-info">
          <div class="wa-chat-name">${name}</div>
          <div class="wa-chat-preview">${preview || 'Sin mensajes'}</div>
        </div>
        <div class="wa-chat-meta">
          <div class="wa-chat-time">${fmtTime(c.ultimo_mensaje_at)}</div>
          ${unread}
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.wa-chat-item').forEach(el => {
      el.addEventListener('click', () => selectChat(parseInt(el.dataset.id, 10)));
    });
  }

  function parseMensajesResponse(data, fallbackId) {
    if (Array.isArray(data)) return { conversacionId: fallbackId, mensajes: data };
    return {
      conversacionId: data?.conversacionId || fallbackId,
      mensajes: data?.mensajes || [],
    };
  }

  async function fetchMensajes(id) {
    const data = await api(`/whatsapp/conversaciones/${id}/mensajes?sync=1`);
    const parsed = parseMensajesResponse(data, id);
    if (parsed.conversacionId && parsed.conversacionId !== selectedId) {
      selectedId = parsed.conversacionId;
      const c = conversaciones.find(x => x.id === selectedId);
      if (c) updateHeader(c);
    }
    return parsed.mensajes;
  }

  async function loadConversaciones() {
    const prev = selectedId ? conversaciones.find(c => c.id === selectedId) : null;
    conversaciones = await api('/whatsapp/conversaciones');
    renderList(document.getElementById('waSearch').value.trim());
    if (selectedId) {
      const still = conversaciones.find(c => c.id === selectedId);
      if (still) {
        if (prev && still.no_leidos > (prev.no_leidos || 0)) {
          fetchMensajes(selectedId).then(msgs => {
            renderMessages(msgs);
            api(`/whatsapp/conversaciones/${selectedId}/leer`, { method: 'PATCH', body: {} }).catch(() => {});
          }).catch(() => {});
        }
        updateHeader(still);
      } else if (prev?.phone) {
        const tail = String(prev.phone).replace(/\D/g, '').slice(-9);
        const moved = conversaciones.find(c => String(c.phone || '').replace(/\D/g, '').endsWith(tail));
        if (moved) {
          selectedId = moved.id;
          updateHeader(moved);
        }
      }
    }
  }

  function updateHeader(c) {
    const name = displayName(c);
    document.getElementById('waAvatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('waContactName').textContent = name;
    const meta = [];
    if (isRealPhone(c.phone)) meta.push(c.phone);
    if (c.paciente_nombre) meta.push('Paciente vinculado');
    document.getElementById('waContactMeta').textContent = meta.join(' · ');
  }

  async function selectChat(id) {
    selectedId = id;
    const c = conversaciones.find(x => x.id === id);
    if (!c) return;

    updateHeader(c);
    document.getElementById('waCompose').style.display = 'flex';
    renderList(document.getElementById('waSearch').value.trim());

    const msgs = await fetchMensajes(id);
    renderMessages(msgs);
    await api(`/whatsapp/conversaciones/${id}/leer`, { method: 'PATCH', body: {} }).catch(() => {});
    c.no_leidos = 0;
    renderList(document.getElementById('waSearch').value.trim());
  }

  function origenLabel(o) {
    if (o === 'telefono') return 'Enviado desde celular';
    if (o === 'crm') return 'Enviado desde CRM';
    return '';
  }

  function ackHtml(m) {
    if (m.direccion !== 'outgoing') return '';
    const s = m.ack_status || 'sent';
    if (s === 'read') return '<span class="wa-msg-ack read" title="Leído">✓✓</span>';
    if (s === 'delivered') return '<span class="wa-msg-ack" title="Entregado">✓✓</span>';
    return '<span class="wa-msg-ack" title="Enviado">✓</span>';
  }

  function renderMessages(msgs) {
    const box = document.getElementById('waMessages');
    if (!msgs.length) {
      box.innerHTML = '<div class="wa-empty">No hay mensajes en este chat</div>';
      return;
    }

    box.innerHTML = msgs.map(m => {
      const cls = m.direccion === 'outgoing' ? 'out' : 'in';
      const ts = m.timestamp_wa
        ? new Date(m.timestamp_wa * 1000)
        : new Date(m.created_at);
      const source = m.direccion === 'outgoing' ? origenLabel(m.origen) : '';
      const sender = m.enviado_nombre ? ` · ${m.enviado_nombre}` : '';
      return `<div class="wa-msg ${cls}">
        <div class="wa-msg-body">${renderMessageBody(m)}</div>
        <div class="wa-msg-meta">
          <span class="wa-msg-time">${fmtTime(ts)}${esc(sender)}</span>
          ${ackHtml(m)}
        </div>
        ${source ? `<div class="wa-msg-source">${esc(source)}</div>` : ''}
      </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function setComposeBusy(busy) {
    sending = busy;
    document.getElementById('waSendBtn').disabled = busy;
    document.getElementById('waInput').disabled = busy;
    document.getElementById('waAttachBtn').disabled = busy;
    document.getElementById('waMicBtn').disabled = busy;
  }

  async function refreshAfterSend(res) {
    if (res?.conversacionId) selectedId = res.conversacionId;
    const msgs = await fetchMensajes(selectedId);
    renderMessages(msgs);
    await loadConversaciones();
  }

  async function sendMessage() {
    const input = document.getElementById('waInput');
    const text = input.value.trim();
    if (!text || !selectedId || sending) return;

    setComposeBusy(true);
    input.value = '';

    try {
      const res = await api(`/whatsapp/conversaciones/${selectedId}/mensajes`, {
        method: 'POST',
        body: { mensaje: text },
      });
      await refreshAfterSend(res);
    } catch (err) {
      toast(err.message, 'danger');
      const msgs = await fetchMensajes(selectedId).catch(() => []);
      renderMessages(msgs);
    } finally {
      setComposeBusy(false);
      input.focus();
    }
  }

  async function sendMedia(file, caption = '', duration = null) {
    if (!file || !selectedId || sending) return;

    setComposeBusy(true);
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    if (duration != null) form.append('duration', String(duration));

    try {
      const res = await fetch(`${API_BASE}/whatsapp/conversaciones/${selectedId}/mensajes/media`, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      await refreshAfterSend(data);
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setComposeBusy(false);
    }
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (isImage || isVideo) {
      const cap = window.prompt('Caption (opcional):', '') || '';
      sendMedia(file, cap.trim());
      return;
    }
    sendMedia(file);
  }

  function setRecordingUI(active) {
    const btn = document.getElementById('waMicBtn');
    btn.classList.toggle('recording', active);
    btn.innerHTML = active ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-microphone"></i>';
    btn.title = active ? 'Detener grabación' : 'Grabar nota de voz';
  }

  async function toggleRecording() {
    if (!selectedId || sending) return;

    if (recording && mediaRecorder) {
      mediaRecorder.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Tu navegador no permite grabar audio', 'danger');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '');
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      audioChunks = [];
      recordStartedAt = Date.now();

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data?.size) audioChunks.push(ev.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        recording = false;
        setRecordingUI(false);
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (!blob.size) return;
        const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `nota-voz.${ext}`, { type: blob.type });
        const duration = Math.max(1, Math.round((Date.now() - recordStartedAt) / 1000));
        await sendMedia(file, '', duration);
      };

      mediaRecorder.start();
      recording = true;
      setRecordingUI(true);
    } catch (err) {
      toast('No se pudo acceder al micrófono', 'danger');
    }
  }

  function nuevoChat() {
    openModal('Nuevo chat', `
      <div class="form-group">
        <label class="form-label">Teléfono (con código de país)</label>
        <input class="form-control" id="waNuevoTel" placeholder="51999999999 o 999999999" inputmode="tel">
        <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Perú: 9 dígitos (999…) o con código 51. Ej: 51999999999</span>
      </div>
    `, async () => {
      const tel = document.getElementById('waNuevoTel').value.trim();
      if (!tel) throw new Error('Ingresa un teléfono');
      const conv = await api('/whatsapp/iniciar', { method: 'POST', body: { telefono: tel } });
      closeModal();
      await loadConversaciones();
      await selectChat(conv.id);
    });
  }

  async function checkStatus() {
    try {
      const st = await api('/whatsapp/status');
      const banner = document.getElementById('waStatusBanner');
      if (!st.configured || !st.hasWebhookToken) {
        banner.style.display = 'block';
        banner.textContent = !st.configured
          ? 'OpenWA no está configurado. Ve a Integraciones.'
          : 'Configura el token webhook en Integraciones y en OpenWA para recibir mensajes.';
      } else {
        banner.style.display = 'none';
      }
    } catch (_) {}
  }

  document.getElementById('waSendBtn').addEventListener('click', sendMessage);
  document.getElementById('waInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('waSearch').addEventListener('input', e => renderList(e.target.value.trim()));
  document.getElementById('btnNuevoChat').addEventListener('click', nuevoChat);
  document.getElementById('waAttachBtn').addEventListener('click', () => document.getElementById('waFileInput').click());
  document.getElementById('waFileInput').addEventListener('change', onFileSelected);
  document.getElementById('waMicBtn').addEventListener('click', toggleRecording);

  loadConversaciones();
  checkStatus();
  pollTimer = setInterval(() => {
    loadConversaciones().then(() => {
      if (selectedId) {
        fetchMensajes(selectedId).then(renderMessages).catch(() => {});
      }
    });
  }, 3000);

  window.addEventListener('beforeunload', () => clearInterval(pollTimer));
})();
