/* VHM CRM — Bandeja Instagram */
(function () {
  'use strict';

  const { api, toast, esc, fmtTime, fmtDateTime } = window.CRM;
  const POLL_MS = 10000;
  const ES_STAFF = ['superadmin', 'admin', 'recepcion'].includes(window.__USER_ROL__);

  let conversaciones = [];
  let terapeutas = [];
  let selectedId = null;
  let verMetricas = false;
  let pollTimer = null;
  let polling = false;
  let sending = false;

  const $ = (id) => document.getElementById(id);

  function displayName(c) {
    if (c.nombre) return c.nombre;
    if (c.username) return `@${c.username}`;
    return 'Usuario de Instagram';
  }

  function renderList(filter = '') {
    const list = $('scChatList');
    const q = filter.toLowerCase();
    const items = q
      ? conversaciones.filter(c => displayName(c).toLowerCase().includes(q) || (c.username || '').toLowerCase().includes(q))
      : conversaciones;

    if (!items.length) {
      list.innerHTML = '<div class="sc-empty">No hay conversaciones</div>';
      return;
    }

    list.innerHTML = items.map(c => {
      const name = esc(displayName(c));
      const preview = esc((c.ultimo_mensaje || '').slice(0, 60));
      const active = selectedId === c.id ? 'active' : '';
      const unread = c.no_leidos > 0 ? `<span class="sc-unread">${c.no_leidos}</span>` : '';
      return `<div class="sc-chat-item ${active}" data-id="${c.id}">
        <div class="sc-avatar">${name.charAt(0).toUpperCase()}</div>
        <div class="sc-chat-info">
          <div class="sc-chat-name">${name}</div>
          <div class="sc-chat-preview">${preview || 'Sin mensajes'}</div>
        </div>
        <div class="sc-chat-meta">
          <div class="sc-chat-time">${fmtTime(c.ultimo_mensaje_at)}</div>
          ${unread}
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.sc-chat-item').forEach(el => {
      el.addEventListener('click', () => selectChat(parseInt(el.dataset.id, 10)));
    });
  }

  async function loadConversaciones({ silent = false } = {}) {
    conversaciones = await api('/social/conversaciones', {
      loader: !silent,
      loaderMessage: silent ? undefined : 'Cargando conversaciones…',
    });
    renderList($('scSearch').value.trim());
    const c = conversaciones.find(x => x.id === selectedId);
    if (c) updateHeader(c);
  }

  function updateHeader(c) {
    const name = displayName(c);
    $('scAvatar').textContent = name.charAt(0).toUpperCase();
    $('scContactName').textContent = name;
    const meta = [];
    if (c.username && c.nombre) meta.push(`@${c.username}`);
    if (c.asignado_nombre) meta.push(`Asignada a ${c.asignado_nombre} ${c.asignado_apellido || ''}`.trim());
    $('scContactMeta').textContent = meta.join(' · ');
    const box = $('scAssign');
    box.style.display = ES_STAFF ? 'flex' : 'none';
    if (ES_STAFF) {
      const sel = $('scAssignSelect');
      sel.innerHTML = '<option value="">Sin asignar</option>' + terapeutas
        .map(t => `<option value="${t.id}">${esc(`${t.nombre} ${t.apellido || ''}`.trim())}</option>`).join('');
      sel.value = c.asignado_a ? String(c.asignado_a) : '';
    }
  }

  function renderMessages(data) {
    const box = $('scMessages');
    const msgs = data.mensajes || [];
    if (!msgs.length) {
      box.innerHTML = '<div class="sc-empty">No hay mensajes en este chat</div>';
    } else {
      box.innerHTML = msgs.map(m => {
        const cls = m.direccion === 'outgoing' ? 'out' : 'in';
        const sender = m.direccion === 'outgoing' && m.enviado_nombre
          ? ` · ${`${m.enviado_nombre} ${m.enviado_apellido || ''}`.trim()}` : '';
        return `<div class="sc-msg ${cls}">
          <div class="sc-msg-body">${esc(m.cuerpo || '')}</div>
          <div class="sc-msg-meta"><span class="sc-msg-time">${esc(fmtDateTime(m.recibido_at))}${esc(sender)}</span></div>
        </div>`;
      }).join('');
      box.scrollTop = box.scrollHeight;
    }

    const note = $('scWindowNote');
    const compose = $('scCompose');
    compose.style.display = 'flex';
    note.style.display = 'block';
    if (data.ventana_abierta) {
      note.className = 'sc-window-note';
      note.textContent = `Puedes responder hasta el ${fmtDateTime(data.ventana_expira_at)} (24 h desde el último mensaje del usuario).`;
    } else {
      note.className = 'sc-window-note closed';
      note.textContent = 'Pasaron más de 24 horas desde el último mensaje del usuario: Instagram no permite responder.';
    }
    $('scInput').disabled = !data.ventana_abierta || sending;
    $('scSendBtn').disabled = !data.ventana_abierta || sending;
  }

  async function fetchMensajes(id, { silent = false } = {}) {
    return api(`/social/conversaciones/${id}/mensajes`, {
      loader: !silent,
      loaderMessage: silent ? undefined : 'Cargando mensajes…',
    });
  }

  function mostrarVista(metricas) {
    verMetricas = metricas;
    $('scMetrics').style.display = metricas ? 'block' : 'none';
    $('scMessages').style.display = metricas ? 'none' : 'flex';
    if (metricas) {
      $('scCompose').style.display = 'none';
      $('scWindowNote').style.display = 'none';
    }
  }

  async function selectChat(id) {
    mostrarVista(false);
    selectedId = id;
    const c = conversaciones.find(x => x.id === id);
    if (!c) return;
    updateHeader(c);
    renderList($('scSearch').value.trim());
    try {
      renderMessages(await fetchMensajes(id));
      await api(`/social/conversaciones/${id}/leer`, { method: 'PATCH', body: {}, loader: false }).catch(() => {});
      c.no_leidos = 0;
      renderList($('scSearch').value.trim());
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function sendMessage() {
    const input = $('scInput');
    const text = input.value.trim();
    if (!text || !selectedId || sending) return;
    sending = true;
    $('scSendBtn').disabled = true;
    input.disabled = true;
    try {
      await api(`/social/conversaciones/${selectedId}/mensajes`, { method: 'POST', body: { mensaje: text } });
      input.value = '';
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      sending = false;
      input.disabled = false;
      $('scSendBtn').disabled = false;
      input.focus();
    }
    try {
      renderMessages(await fetchMensajes(selectedId, { silent: true }));
      await loadConversaciones({ silent: true });
    } catch (_) {}
  }

  function fmtDuracion(seg) {
    if (seg == null) return '—';
    const s = Number(seg);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${(s / 3600).toFixed(1)} h`;
  }

  async function cargarMetricas() {
    mostrarVista(true);
    selectedId = null;
    renderList($('scSearch').value.trim());
    try {
      const d = await api('/social/metricas');
      const horas = d.por_hora.map(h => `<tr><td>${String(h.hora).padStart(2, '0')}:00</td><td>${h.consultas}</td><td>${h.respondidas}</td><td>${fmtDuracion(h.seg_primera_respuesta)}</td></tr>`).join('');
      const ter = d.por_terapeuta.map(t => `<tr><td>${esc(t.nombre ? `${t.nombre} ${t.apellido || ''}`.trim() : 'Sin terapeuta (app de Instagram)')}</td><td>${t.respondidas}</td><td>${fmtDuracion(t.seg_primera_respuesta)}</td></tr>`).join('');
      $('scMetrics').innerHTML = `
        <h3>Consultas del ${esc(d.desde)} al ${esc(d.hasta)} (hora Lima)</h3>
        <p style="font-size:12px;color:var(--text-muted)">Sin responder: ${d.sin_responder}</p>
        <h4>Por hora de recepción</h4>
        <table><thead><tr><th>Hora</th><th>Consultas</th><th>Respondidas</th><th>Primera respuesta (prom.)</th></tr></thead><tbody>${horas || '<tr><td colspan="4">Sin datos</td></tr>'}</tbody></table>
        <h4>Por terapeuta</h4>
        <table><thead><tr><th>Terapeuta</th><th>Respondidas</th><th>Primera respuesta (prom.)</th></tr></thead><tbody>${ter || '<tr><td colspan="3">Sin datos</td></tr>'}</tbody></table>`;
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function checkStatus() {
    try {
      const st = await api('/social/status', { loader: false });
      const banner = $('scStatusBanner');
      if (!st.cuenta_configurada || !st.token_configurado || !st.webhook_configurado) {
        banner.style.display = 'block';
        banner.textContent = 'Instagram no está configurado por completo. Ve a Integraciones.';
      } else {
        banner.style.display = 'none';
      }
    } catch (_) {}
  }

  async function pollTick() {
    if (polling || sending || document.visibilityState === 'hidden') return;
    polling = true;
    try {
      await loadConversaciones({ silent: true });
      if (selectedId && !verMetricas) renderMessages(await fetchMensajes(selectedId, { silent: true }));
    } catch (_) {
    } finally {
      polling = false;
    }
  }

  function startPolling() {
    if (!pollTimer) pollTimer = setInterval(pollTick, POLL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  $('scSendBtn').addEventListener('click', sendMessage);
  $('scInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });
  $('scSearch').addEventListener('input', e => renderList(e.target.value.trim()));
  $('scBtnMetricas').addEventListener('click', cargarMetricas);
  $('scAssignSelect').addEventListener('change', async (e) => {
    if (!selectedId) return;
    try {
      await api(`/social/conversaciones/${selectedId}/asignar`, {
        method: 'PATCH',
        body: { terapeuta_id: e.target.value || null },
        successMessage: 'Asignación actualizada',
      });
      await loadConversaciones({ silent: true });
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { stopPolling(); return; }
    pollTick();
    startPolling();
  });

  (async function init() {
    if (ES_STAFF) {
      try { terapeutas = await api('/social/terapeutas', { loader: false }); } catch (_) {}
    }
    try { await loadConversaciones(); } catch (err) { toast(err.message, 'danger'); }
    checkStatus();
    if (document.visibilityState !== 'hidden') startPolling();
  })();

  window.addEventListener('beforeunload', stopPolling);
})();
