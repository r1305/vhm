/* VHM CRM — Central WhatsApp */
(function () {
  'use strict';

  const { api, toast, esc, openModal, closeModal } = window.CRM;

  let conversaciones = [];
  let selectedId = null;
  let pollTimer = null;
  let sending = false;

  function fmtTime(d) {
    if (!d) return '';
    const dt = new Date(d);
    const now = new Date();
    const sameDay = dt.toDateString() === now.toDateString();
    return sameDay
      ? dt.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
      : dt.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
  }

  function displayName(c) {
    if (c.paciente_nombre) return `${c.paciente_nombre} ${c.paciente_apellido || ''}`.trim();
    return c.contact_name || c.phone || 'Desconocido';
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

  async function loadConversaciones() {
    conversaciones = await api('/whatsapp/conversaciones');
    renderList(document.getElementById('waSearch').value.trim());
    if (selectedId) {
      const still = conversaciones.find(c => c.id === selectedId);
      if (still) updateHeader(still);
    }
  }

  function updateHeader(c) {
    const name = displayName(c);
    document.getElementById('waAvatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('waContactName').textContent = name;
    const meta = [];
    if (c.phone) meta.push(c.phone);
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

    const msgs = await api(`/whatsapp/conversaciones/${id}/mensajes`);
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
        <div>${esc(m.cuerpo || '')}</div>
        <div class="wa-msg-time">${fmtTime(ts)}${esc(sender)}</div>
        ${source ? `<div class="wa-msg-source">${esc(source)}</div>` : ''}
      </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function sendMessage() {
    const input = document.getElementById('waInput');
    const text = input.value.trim();
    if (!text || !selectedId || sending) return;

    sending = true;
    const btn = document.getElementById('waSendBtn');
    btn.disabled = true;
    input.disabled = true;

    try {
      const res = await api(`/whatsapp/conversaciones/${selectedId}/mensajes`, {
        method: 'POST',
        body: { mensaje: text },
      });
      input.value = '';
      if (res.conversacionId && res.conversacionId !== selectedId) {
        selectedId = res.conversacionId;
      }
      const msgs = await api(`/whatsapp/conversaciones/${selectedId}/mensajes`);
      renderMessages(msgs);
      await loadConversaciones();
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      sending = false;
      btn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function nuevoChat() {
    openModal('Nuevo chat', `
      <div class="form-group">
        <label class="form-label">Teléfono (con código de país)</label>
        <input class="form-control" id="waNuevoTel" placeholder="51999999999">
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

  loadConversaciones().then(() => {
    if (conversaciones.length) selectChat(conversaciones[0].id);
  });
  checkStatus();
  pollTimer = setInterval(() => {
    loadConversaciones().then(() => {
      if (selectedId) {
        api(`/whatsapp/conversaciones/${selectedId}/mensajes`).then(renderMessages).catch(() => {});
      }
    });
  }, 5000);

  window.addEventListener('beforeunload', () => clearInterval(pollTimer));
})();
