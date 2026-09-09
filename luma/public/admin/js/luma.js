(function () {
  const BASE = (window.__APP_BASE__ || '').replace(/\/+$/, '');
  const API = BASE + '/api';

  // ── AUTH ──────────────────────────────────────────────────────────────────
  function getToken() { return localStorage.getItem('luma_token'); }
  function getUser() { try { return JSON.parse(localStorage.getItem('luma_user') || '{}'); } catch { return {}; } }
  function logout() { localStorage.removeItem('luma_token'); localStorage.removeItem('luma_user'); window.location.href = BASE + '/admin/login'; }
  if (!getToken()) { window.location.href = BASE + '/admin/login'; return; }

  const user = getUser();
  document.getElementById('user-name').textContent = user.nombre || 'Admin';
  document.getElementById('user-rol').textContent = user.rol || 'Administrador';
  document.getElementById('user-avatar').textContent = (user.nombre || 'A').charAt(0).toUpperCase();
  document.getElementById('btn-logout').addEventListener('click', logout);

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken(), 'X-CSRF-Token': getCookie('csrf_token') || '' };
  }
  async function apiFetch(url, opts) {
    const res = await fetch(API + url, { credentials: 'same-origin', ...(opts || {}) });
    if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
    return res;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }
  function isSuperAdmin() { return user.rol === 'SUPERADMIN'; }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  const Toast = {
    show(msg, type) {
      const icons = { success: '✅', error: '❌', info: 'ℹ️' };
      const el = document.createElement('div');
      el.className = 'toast toast-' + type;
      el.innerHTML = '<span class="toast-icon">' + (icons[type]||'ℹ️') + '</span><span class="toast-msg">' + esc(msg) + '</span><button class="toast-close">✕</button>';
      el.querySelector('.toast-close').addEventListener('click', () => removeToast(el));
      document.getElementById('toast-container').appendChild(el);
      setTimeout(() => removeToast(el), 4000);
    },
    success(m) { this.show(m, 'success'); },
    error(m) { this.show(m, 'error'); },
    info(m) { this.show(m, 'info'); },
  };
  function removeToast(el) { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }

  // ── SIDEBAR ───────────────────────────────────────────────────────────────
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  document.getElementById('btn-hamburger').addEventListener('click', () => {
    sidebar.classList.toggle('open'); overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); });

  // Ocultar items de sistema si no es SUPERADMIN
  if (!isSuperAdmin()) {
    document.querySelectorAll('.nav-item[data-page="administradores"], .nav-item[data-page="roles"], .nav-item[data-page="accesos"]').forEach(b => {
      b.style.display = 'none';
    });
  }

  // ── MODALES ───────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.modalClose).classList.remove('show'));
  });
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('show'); });
  });

  // ── NAVEGACIÓN ────────────────────────────────────────────────────────────
  const titles = { dashboard: '📊 Dashboard', eventos: '📋 Eventos', registros: '👥 Registros', administradores: '🧑‍💼 Administradores', roles: '🎭 Roles', accesos: '🔑 Accesos' };
  const PAGES = Object.keys(titles);
  let currentPage = 'dashboard';

  function pageFromUrl() {
    const seg = window.location.pathname.replace(/\/+$/, '').split('/').pop();
    return PAGES.includes(seg) ? seg : 'dashboard';
  }

  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      sidebar.classList.remove('open'); overlay.classList.remove('show');
      navigateTo(btn.dataset.page, true);
    });
  });

  window.addEventListener('popstate', () => navigateTo(pageFromUrl(), false));

  function navigateTo(page, push) {
    currentPage = page;
    document.getElementById('page-title').textContent = titles[page] || page;
    document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    if (push) history.pushState({ page }, '', BASE + '/admin/' + page);
    const content = document.getElementById('main-content');
    if (page === 'dashboard') renderDashboard(content);
    else if (page === 'eventos') renderEventosPage(content);
    else if (page === 'registros') renderRegistrosPage(content);
    else if (page === 'administradores') renderAdminsPage(content);
    else if (page === 'roles') renderRolesPage(content);
    else if (page === 'accesos') renderAccesosPage(content);
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function fmt(fecha) {
    if (!fecha) return '';
    const [y, m, d] = fecha.split('T')[0].split('-');
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return parseInt(d) + ' ' + meses[parseInt(m)-1] + ' ' + y;
  }
  function fmtHora(h) { return h ? h.slice(0,5) : ''; }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  async function renderDashboard(el) {
    el.innerHTML = '<div class="stats-row"><div class="stat-card"><div class="stat-label">Eventos activos</div><div class="stat-value" id="st-eventos">—</div></div><div class="stat-card"><div class="stat-label">Próximos</div><div class="stat-value" id="st-proximos">—</div></div><div class="stat-card"><div class="stat-label">Registrados</div><div class="stat-value" id="st-registros">—</div></div><div class="stat-card"><div class="stat-label">Asistieron</div><div class="stat-value" id="st-asistieron" style="color:var(--color-success)">—</div></div></div><div class="section-header" style="margin-top:8px"><div><h2>Próximos eventos</h2><p>Eventos activos ordenados por fecha</p></div><button class="btn btn-primary btn-sm" id="btn-dash-nuevo">+ Nuevo evento</button></div><div id="dash-eventos-list"></div>';
    document.getElementById('btn-dash-nuevo').addEventListener('click', () => abrirModalEvento());
    try {
      const [statsRes, evtRes] = await Promise.all([
        apiFetch('/admin/stats', { headers: authHeaders() }),
        apiFetch('/admin/eventos', { headers: authHeaders() }),
      ]);
      const stats = await statsRes.json();
      const eventos = await evtRes.json();
      document.getElementById('st-eventos').textContent = stats.total_eventos ?? '—';
      document.getElementById('st-proximos').textContent = stats.proximos ?? '—';
      document.getElementById('st-registros').textContent = stats.total_registros ?? '—';
      const tasaGlobal = stats.total_registros > 0 ? Math.round((stats.asistieron / stats.total_registros) * 100) : 0;
      document.getElementById('st-asistieron').textContent = (stats.asistieron ?? '—') + (stats.total_registros ? ' (' + tasaGlobal + '%)' : '');
      const hoy = new Date().toISOString().split('T')[0];
      const proximos = eventos.filter(e => e.activo && e.fecha >= hoy).slice(0, 5);
      const list = document.getElementById('dash-eventos-list');
      if (!proximos.length) { list.innerHTML = '<div class="card"><div class="card-body"><p style="padding:24px;text-align:center;color:var(--text-muted)">Sin eventos próximos</p></div></div>'; return; }
      list.innerHTML = '<div class="card"><div class="card-body"><div class="table-desktop"><table><thead><tr><th>Nombre</th><th>Fecha</th><th>Lugar</th><th>Registrados</th><th>Asistieron</th><th>Capacidad</th></tr></thead><tbody>' +
        proximos.map(e => {
          const regs = Number(e.registrados) || 0;
          const asist = Number(e.asistieron) || 0;
          const pctAsist = regs ? Math.round((asist / regs) * 100) : 0;
          const pctCap = e.capacidad ? Math.min(100, Math.round((regs / e.capacidad) * 100)) : null;
          return '<tr><td><strong>' + esc(e.nombre) + '</strong></td><td>' + fmt(e.fecha) + '</td><td>' + esc(e.lugar) + '</td><td><strong>' + regs + '</strong>' + (pctCap !== null ? '<div class="progress-bar"><div class="progress-fill" style="width:' + pctCap + '%"></div></div>' : '') + '</td><td><strong style="color:var(--color-success)">' + asist + '</strong><div style="font-size:.72rem;color:var(--text-muted)">' + pctAsist + '% asistencia</div></td><td>' + (e.capacidad || '∞') + '</td></tr>';
        }).join('') + '</tbody></table></div></div></div>';
    } catch { Toast.error('Error al cargar datos'); }
  }

  // ── EVENTOS PAGE ──────────────────────────────────────────────────────────
  let eventosData = [];
  let eventoExpandido = null;
  let registrosPorEvento = {};

  function pctAsistencia(regs, asist) {
    regs = Number(regs) || 0;
    asist = Number(asist) || 0;
    return regs ? Math.round((asist / regs) * 100) : 0;
  }

  function statsEventoHtml(e) {
    const regs = Number(e.registrados) || 0;
    const asist = Number(e.asistieron) || 0;
    const pct = pctAsistencia(regs, asist);
    return '<div class="evento-stats">' +
      '<div class="evento-stat"><div class="val">' + regs + '</div><div class="lbl">Registrados</div></div>' +
      '<div class="evento-stat highlight"><div class="val">' + asist + '</div><div class="lbl">Asistieron</div></div>' +
      '<div class="evento-stat"><div class="val">' + pct + '%</div><div class="lbl">Asistencia</div></div>' +
      (e.capacidad ? '<div class="evento-stat"><div class="val">' + e.capacidad + '</div><div class="lbl">Capacidad</div></div>' : '') +
      '</div>';
  }

  async function renderEventosPage(el) {
    el.innerHTML = '<div class="filter-row"><input type="text" id="evt-search" placeholder="Buscar evento..." style="width:200px"><button class="btn btn-primary btn-sm" id="btn-buscar-evt">🔍 Buscar</button><button class="btn btn-primary btn-sm" id="btn-nuevo-evento" style="margin-left:auto">+ Nuevo evento</button></div><div class="evento-list" id="evt-list"></div>';
    document.getElementById('btn-nuevo-evento').addEventListener('click', () => abrirModalEvento());
    document.getElementById('btn-buscar-evt').addEventListener('click', () => {
      const q = document.getElementById('evt-search').value.trim().toLowerCase();
      renderListaEventos(q ? eventosData.filter(e => e.nombre.toLowerCase().includes(q) || e.lugar.toLowerCase().includes(q)) : eventosData);
    });
    document.getElementById('evt-search').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-buscar-evt').click(); });
    await cargarEventos();
  }

  async function cargarEventos() {
    try {
      const res = await apiFetch('/admin/eventos', { headers: authHeaders() });
      eventosData = await res.json();
      renderListaEventos(eventosData);
    } catch { Toast.error('Error al cargar eventos'); }
  }

  function renderListaEventos(lista) {
    const container = document.getElementById('evt-list');
    if (!container) return;
    if (!lista.length) {
      container.innerHTML = '<div class="card"><div class="card-body"><p style="padding:32px;text-align:center;color:var(--text-muted)">📭 Sin eventos</p></div></div>';
      return;
    }
    container.innerHTML = lista.map(e => {
      const abierto = eventoExpandido === e.id;
      return '<div class="evento-item' + (abierto ? ' open' : '') + '" data-evento-id="' + e.id + '">' +
        '<div class="evento-summary" data-toggle-evento="' + e.id + '">' +
          '<button type="button" class="evento-toggle" aria-label="Ver registros">▶</button>' +
          '<div class="evento-info">' +
            '<div class="evento-name">' + esc(e.nombre) + ' <span class="badge ' + (e.activo ? 'badge-activo' : 'badge-inactivo') + '" style="margin-left:6px;vertical-align:middle">' + (e.activo ? 'Activo' : 'Inactivo') + '</span></div>' +
            '<div class="evento-meta"><span>📅 ' + fmt(e.fecha) + '</span><span>🕐 ' + fmtHora(e.hora_inicio) + (e.hora_fin ? ' – ' + fmtHora(e.hora_fin) : '') + '</span><span>📍 ' + esc(e.lugar) + '</span></div>' +
          '</div>' +
          statsEventoHtml(e) +
          '<div class="evento-actions" onclick="event.stopPropagation()">' +
            '<button class="btn btn-outline btn-xs" onclick="window._lumaEditEvento(' + e.id + ')">✏️</button>' +
            '<button class="btn btn-danger btn-xs" onclick="window._lumaDelEvento(' + e.id + ')">🗑️</button>' +
          '</div>' +
        '</div>' +
        '<div class="evento-detail" id="evt-detail-' + e.id + '">' +
          (abierto ? renderDetalleRegistros(e.id, registrosPorEvento[e.id]) : '<p style="padding:20px;color:var(--text-muted);font-size:.85rem">Cargando registros...</p>') +
        '</div>' +
      '</div>';
    }).join('');

    container.querySelectorAll('[data-toggle-evento]').forEach(row => {
      row.addEventListener('click', () => toggleEvento(parseInt(row.dataset.toggleEvento, 10)));
    });
  }

  async function toggleEvento(id) {
    if (eventoExpandido === id) {
      eventoExpandido = null;
      renderListaEventos(eventosData);
      return;
    }
    eventoExpandido = id;
    renderListaEventos(eventosData);
    await cargarRegistrosEvento(id);
  }

  async function cargarRegistrosEvento(eventoId) {
    const detail = document.getElementById('evt-detail-' + eventoId);
    if (!detail) return;
    if (!registrosPorEvento[eventoId]) {
      detail.innerHTML = '<p style="padding:20px;color:var(--text-muted);font-size:.85rem">Cargando registros...</p>';
    }
    try {
      const res = await apiFetch('/admin/eventos/' + eventoId + '/registros', { headers: authHeaders() });
      registrosPorEvento[eventoId] = await res.json();
      detail.innerHTML = renderDetalleRegistros(eventoId, registrosPorEvento[eventoId]);
      bindAsistenciaChecks(eventoId);
      actualizarStatsEvento(eventoId);
    } catch {
      detail.innerHTML = '<p style="padding:20px;color:var(--color-danger);font-size:.85rem">Error al cargar registros</p>';
    }
  }

  function renderDetalleRegistros(eventoId, lista) {
    lista = lista || [];
    const activos = lista.filter(r => r.estado !== 'cancelado');
    const asistieron = activos.filter(r => r.asistio).length;
    const pct = pctAsistencia(activos.length, asistieron);

    if (!lista.length) {
      return '<div class="evento-detail-header"><h4>👥 Registros</h4></div><p style="padding:20px;color:var(--text-muted);font-size:.85rem">Sin registros para este evento</p>';
    }

    const barHtml = activos.length
      ? '<div class="asistencia-bar-wrap"><div class="asistencia-bar-label"><span>Asistencia real vs registrados</span><span><strong style="color:var(--color-success)">' + asistieron + '</strong> / ' + activos.length + ' (' + pct + '%)</span></div><div class="progress-bar"><div class="progress-fill success" style="width:' + pct + '%"></div></div></div>'
      : '';

    const rows = lista.map(r => {
      const cancelado = r.estado === 'cancelado';
      return '<tr class="' + (r.asistio ? 'asistio' : '') + (cancelado ? ' asistio-cancelado' : '') + '">' +
        '<td style="text-align:center"><input type="checkbox" class="asist-check" data-reg-id="' + r.id + '" data-evento-id="' + eventoId + '"' + (r.asistio ? ' checked' : '') + (cancelado ? ' disabled title="Registro cancelado"' : '') + '></td>' +
        '<td><strong>' + esc(r.nombre) + '</strong></td>' +
        '<td>' + esc(r.email) + '</td>' +
        '<td>' + (r.telefono ? esc(r.telefono) : '<span style="color:var(--text-muted)">—</span>') + '</td>' +
        '<td><span class="estado-badge estado-' + r.estado + '">' + r.estado + '</span></td>' +
        '<td style="font-size:.8rem;color:var(--text-muted)">' + (r.fecha_asistencia ? new Date(r.fecha_asistencia).toLocaleString('es-PE') : '—') + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="evento-detail-header"><h4>👥 Lista de registros — marca asistencia el día del evento</h4></div>' +
      barHtml +
      '<div class="card-body" style="padding:0"><div class="table-desktop"><table><thead><tr><th style="width:48px">✓</th><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Estado</th><th>Hora asistencia</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<div class="mobile-cards" style="display:block;padding:12px">' +
      lista.map(r => {
        const cancelado = r.estado === 'cancelado';
        return '<div class="mc-item"' + (r.asistio ? ' style="border-color:#10b981"' : '') + '><div class="mc-header"><label style="display:flex;align-items:center;gap:10px;cursor:' + (cancelado ? 'default' : 'pointer') + '"><input type="checkbox" class="asist-check" data-reg-id="' + r.id + '" data-evento-id="' + eventoId + '"' + (r.asistio ? ' checked' : '') + (cancelado ? ' disabled' : '') + '><div class="mc-title">' + esc(r.nombre) + '</div></label><span class="estado-badge estado-' + r.estado + '">' + r.estado + '</span></div><div class="mc-row">📧 ' + esc(r.email) + '</div>' + (r.asistio && r.fecha_asistencia ? '<div class="mc-row" style="color:var(--color-success)">✅ ' + new Date(r.fecha_asistencia).toLocaleString('es-PE') + '</div>' : '') + '</div>';
      }).join('') +
      '</div></div>';
  }

  function bindAsistenciaChecks(eventoId) {
    document.querySelectorAll('#evt-detail-' + eventoId + ' .asist-check').forEach(chk => {
      chk.addEventListener('change', () => toggleAsistencia(chk));
    });
  }

  async function toggleAsistencia(chk) {
    const regId = chk.dataset.regId;
    const eventoId = parseInt(chk.dataset.eventoId, 10);
    const asistio = chk.checked;
    chk.disabled = true;
    try {
      const res = await apiFetch('/admin/registros/' + regId + '/asistencia', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ asistio }),
      });
      const data = await res.json();
      if (res.ok) {
        const lista = registrosPorEvento[eventoId] || [];
        const reg = lista.find(r => r.id == regId);
        if (reg) {
          reg.asistio = asistio ? 1 : 0;
          reg.fecha_asistencia = asistio ? new Date().toISOString() : null;
        }
        actualizarStatsEvento(eventoId);
        const detail = document.getElementById('evt-detail-' + eventoId);
        if (detail) {
          detail.innerHTML = renderDetalleRegistros(eventoId, lista);
          bindAsistenciaChecks(eventoId);
        }
        Toast.success(data.message);
      } else {
        chk.checked = !asistio;
        Toast.error(data.error || 'Error al marcar asistencia');
      }
    } catch {
      chk.checked = !asistio;
      Toast.error('Error de conexión');
    } finally {
      chk.disabled = false;
    }
  }

  function actualizarStatsEvento(eventoId) {
    const lista = registrosPorEvento[eventoId] || [];
    const activos = lista.filter(r => r.estado !== 'cancelado');
    const asistieron = activos.filter(r => r.asistio).length;
    const evt = eventosData.find(e => e.id === eventoId);
    if (evt) {
      evt.registrados = activos.length;
      evt.asistieron = asistieron;
    }
    const item = document.querySelector('.evento-item[data-evento-id="' + eventoId + '"] .evento-stats');
    if (item && evt) item.outerHTML = statsEventoHtml(evt);
  }

  // ── MODAL EVENTO ──────────────────────────────────────────────────────────
  let eventoEditId = null;
  let eventoItemsDraft = [];

  function renderEventoItemsDraft() {
    const list = document.getElementById('ef-items-list');
    if (!list) return;
    if (!eventoItemsDraft.length) {
      list.innerHTML = '<p style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">Sin ítems agregados.</p>';
      return;
    }
    list.innerHTML = eventoItemsDraft.map((item, idx) => {
      const ocupados = Number(item.ocupados || 0);
      const minQty = Math.max(1, ocupados);
      return '<div class="item-row" data-item-idx="' + idx + '">' +
        '<input type="text" class="item-nombre" placeholder="Ej: Galletas" value="' + esc(item.nombre || '') + '">' +
        '<div class="qty-control">' +
          '<button type="button" class="qty-btn item-qty-minus">−</button>' +
          '<span class="qty-val">' + item.cantidad + '</span>' +
          '<button type="button" class="qty-btn item-qty-plus">+</button>' +
        '</div>' +
        (ocupados ? '<span class="item-meta">' + ocupados + ' tomado(s)</span>' : '') +
        '<button type="button" class="btn btn-danger btn-xs item-remove">✕</button>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.item-row').forEach(row => {
      const idx = parseInt(row.dataset.itemIdx, 10);
      row.querySelector('.item-nombre').addEventListener('input', e => { eventoItemsDraft[idx].nombre = e.target.value; });
      row.querySelector('.item-qty-minus').addEventListener('click', () => {
        const minQty = Math.max(1, Number(eventoItemsDraft[idx].ocupados || 0));
        eventoItemsDraft[idx].cantidad = Math.max(minQty, Number(eventoItemsDraft[idx].cantidad || 1) - 1);
        renderEventoItemsDraft();
      });
      row.querySelector('.item-qty-plus').addEventListener('click', () => {
        eventoItemsDraft[idx].cantidad = Math.max(1, Number(eventoItemsDraft[idx].cantidad || 1) + 1);
        renderEventoItemsDraft();
      });
      row.querySelector('.item-remove').addEventListener('click', () => {
        if (Number(eventoItemsDraft[idx].ocupados || 0) > 0) {
          Toast.error('No puedes eliminar un ítem que ya tiene inscritos');
          return;
        }
        eventoItemsDraft.splice(idx, 1);
        renderEventoItemsDraft();
      });
    });
  }

  async function abrirModalEvento(id) {
    eventoEditId = id || null;
    let e = id ? eventosData.find(x => x.id === id) : null;
    if (id) {
      try {
        const res = await apiFetch('/admin/eventos/' + id, { headers: authHeaders() });
        if (res.ok) e = await res.json();
      } catch (_) {}
    }
    document.getElementById('modal-evento-title').textContent = e ? '✏️ Editar Evento' : '📅 Nuevo Evento';
    document.getElementById('ef-nombre').value = e?.nombre || '';
    document.getElementById('ef-descripcion').value = e?.descripcion || '';
    document.getElementById('ef-fecha').value = e?.fecha ? e.fecha.split('T')[0] : '';
    document.getElementById('ef-hora_inicio').value = fmtHora(e?.hora_inicio);
    document.getElementById('ef-hora_fin').value = fmtHora(e?.hora_fin);
    document.getElementById('ef-lugar').value = e?.lugar || '';
    document.getElementById('ef-link').value = e?.link || '';
    document.getElementById('ef-capacidad').value = e?.capacidad || '';
    document.getElementById('ef-imagen_url').value = e?.imagen_url || '';
    document.getElementById('ef-activo').value = e ? (e.activo ? '1' : '0') : '1';
    document.getElementById('ef-compromiso_obligatorio').checked = !!(e?.compromiso_obligatorio);
    eventoItemsDraft = (e?.items || []).map(item => ({
      id: item.id,
      nombre: item.nombre,
      cantidad: Number(item.cantidad) || 1,
      ocupados: Number(item.ocupados || 0),
    }));
    renderEventoItemsDraft();
    document.getElementById('modal-evento').classList.add('show');
  }

  window._lumaEditEvento = abrirModalEvento;
  window._lumaDelEvento = async function (id) {
    if (!confirm('¿Eliminar este evento y todos sus registros?')) return;
    try {
      const res = await apiFetch('/admin/eventos/' + id, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        delete registrosPorEvento[id];
        if (eventoExpandido === id) eventoExpandido = null;
        Toast.success(data.message);
        if (currentPage === 'eventos') cargarEventos();
      }
      else Toast.error(data.error || 'Error al eliminar');
    } catch { Toast.error('Error de conexión'); }
  };

  document.getElementById('btn-add-item').addEventListener('click', () => {
    eventoItemsDraft.push({ nombre: '', cantidad: 1, ocupados: 0 });
    renderEventoItemsDraft();
    const list = document.getElementById('ef-items-list');
    const last = list.querySelector('.item-row:last-child .item-nombre');
    if (last) last.focus();
  });

  document.getElementById('btn-guardar-evento').addEventListener('click', async () => {
    const items = eventoItemsDraft
      .map(item => ({ id: item.id, nombre: String(item.nombre || '').trim(), cantidad: Number(item.cantidad) || 1 }))
      .filter(item => item.nombre);
    const body = {
      nombre: document.getElementById('ef-nombre').value,
      descripcion: document.getElementById('ef-descripcion').value,
      fecha: document.getElementById('ef-fecha').value,
      hora_inicio: document.getElementById('ef-hora_inicio').value,
      hora_fin: document.getElementById('ef-hora_fin').value,
      lugar: document.getElementById('ef-lugar').value,
      link: document.getElementById('ef-link').value,
      capacidad: document.getElementById('ef-capacidad').value,
      imagen_url: document.getElementById('ef-imagen_url').value,
      activo: document.getElementById('ef-activo').value,
      compromiso_obligatorio: document.getElementById('ef-compromiso_obligatorio').checked,
      items,
    };
    const url = eventoEditId ? '/admin/eventos/' + eventoEditId : '/admin/eventos';
    const method = eventoEditId ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); document.getElementById('modal-evento').classList.remove('show'); if (currentPage === 'eventos') cargarEventos(); else navigateTo('dashboard'); }
      else Toast.error(data.error || 'Error al guardar');
    } catch { Toast.error('Error de conexión'); }
  });

  // ── REGISTROS PAGE ────────────────────────────────────────────────────────
  let registrosActuales = [];

  async function renderRegistrosPage(el) {
    el.innerHTML = '<div class="filter-row"><select id="reg-evento-select" style="min-width:240px"><option value="">— Selecciona un evento —</option></select><button class="btn btn-primary btn-sm" id="btn-cargar-reg">Ver registros</button><button class="btn btn-outline btn-sm" id="btn-exportar-csv" style="margin-left:auto" disabled>⬇️ Exportar CSV</button></div><div id="reg-panel"></div>';
    document.getElementById('btn-cargar-reg').addEventListener('click', () => {
      const id = document.getElementById('reg-evento-select').value;
      if (!id) { Toast.error('Selecciona un evento'); return; }
      cargarRegistros(id);
    });
    document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);
    try {
      const res = await apiFetch('/admin/eventos', { headers: authHeaders() });
      const lista = await res.json();
      const sel = document.getElementById('reg-evento-select');
      lista.forEach(e => { const opt = document.createElement('option'); opt.value = e.id; opt.textContent = e.nombre + ' (' + fmt(e.fecha) + ') — ' + e.registrados + ' registros'; sel.appendChild(opt); });
    } catch { Toast.error('Error al cargar eventos'); }
  }

  async function cargarRegistros(eventoId) {
    const panel = document.getElementById('reg-panel');
    panel.innerHTML = '<p style="color:var(--text-muted);padding:16px">Cargando...</p>';
    try {
      const res = await apiFetch('/admin/eventos/' + eventoId + '/registros', { headers: authHeaders() });
      registrosActuales = await res.json();
      const csvBtn = document.getElementById('btn-exportar-csv');
      if (csvBtn) csvBtn.disabled = !registrosActuales.length;
      renderTablaRegistros(registrosActuales, eventoId);
    } catch { panel.innerHTML = '<p style="color:var(--color-danger);padding:16px">Error al cargar registros</p>'; }
  }

  function renderTablaRegistros(lista, eventoId) {
    const panel = document.getElementById('reg-panel');
    const activos = lista.filter(r => r.estado !== 'cancelado');
    const confirmados = lista.filter(r => r.estado === 'confirmado').length;
    const pendientes = lista.filter(r => r.estado === 'pendiente').length;
    const cancelados = lista.filter(r => r.estado === 'cancelado').length;
    const asistieron = activos.filter(r => r.asistio).length;
    const pctAsist = pctAsistencia(activos.length, asistieron);
    if (!lista.length) { panel.innerHTML = '<div class="card"><div class="card-body"><p style="padding:32px;text-align:center;color:var(--text-muted)">📭 Sin registros para este evento</p></div></div>'; return; }
    panel.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">' +
      '<div class="stat-card"><div class="stat-label">Registrados</div><div class="stat-value">' + activos.length + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Asistieron</div><div class="stat-value" style="color:var(--color-success)">' + asistieron + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Tasa asistencia</div><div class="stat-value">' + pctAsist + '%</div></div>' +
      '<div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value" style="color:var(--color-warning)">' + pendientes + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Confirmados</div><div class="stat-value" style="color:var(--color-success)">' + confirmados + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Cancelados</div><div class="stat-value" style="color:var(--color-danger)">' + cancelados + '</div></div>' +
      '</div>' +
      '<div class="asistencia-bar-wrap" style="margin-bottom:16px"><div class="asistencia-bar-label"><span>Asistencia real vs registrados</span><span><strong style="color:var(--color-success)">' + asistieron + '</strong> / ' + activos.length + '</span></div><div class="progress-bar"><div class="progress-fill success" style="width:' + pctAsist + '%"></div></div></div>' +
      '<div class="card"><div class="card-body"><div class="table-desktop"><table><thead><tr><th style="width:48px">✓</th><th>#</th><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Cuenta conmigo</th><th>Estado</th><th>Hora asistencia</th><th>Fecha registro</th><th>Acciones</th></tr></thead><tbody>' +
      lista.map((r, i) => {
        const cancelado = r.estado === 'cancelado';
        const itemLabel = r.item_nombre
          ? esc(r.item_nombre)
          : '<span style="color:var(--text-muted)">—</span>';
        return '<tr class="' + (r.asistio ? 'asistio' : '') + (cancelado ? ' asistio-cancelado' : '') + '"><td style="text-align:center"><input type="checkbox" class="asist-check-reg" data-id="' + r.id + '" data-evento="' + eventoId + '"' + (r.asistio ? ' checked' : '') + (cancelado ? ' disabled' : '') + '></td><td>' + (i+1) + '</td><td><strong>' + esc(r.nombre) + '</strong></td><td>' + esc(r.email) + '</td><td>' + (r.telefono ? esc(r.telefono) : '<span style="color:var(--text-muted)">—</span>') + '</td><td>' + itemLabel + '</td><td><select class="estado-select" data-id="' + r.id + '" data-evento="' + eventoId + '" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg-input);color:var(--text-primary);font-size:.78rem"><option value="pendiente"' + (r.estado==='pendiente'?' selected':'') + '>⏳ Pendiente</option><option value="confirmado"' + (r.estado==='confirmado'?' selected':'') + '>✅ Confirmado</option><option value="cancelado"' + (r.estado==='cancelado'?' selected':'') + '>❌ Cancelado</option></select></td><td style="font-size:.8rem;color:var(--text-muted)">' + (r.fecha_asistencia ? new Date(r.fecha_asistencia).toLocaleString('es-PE') : '—') + '</td><td style="font-size:.8rem;color:var(--text-muted)">' + new Date(r.fecha_registro).toLocaleString('es-PE') + '</td><td>' + (r.notas ? '<button class="btn btn-outline btn-xs" onclick="window._lumaVerReg(' + r.id + ')">👁️</button> ' : '') + '<button class="btn btn-danger btn-xs" onclick="window._lumaDelReg(' + r.id + ',' + eventoId + ')">🗑️</button></td></tr>';
      }).join('') +
      '</tbody></table></div><div class="mobile-cards">' +
      lista.map(r => {
        const cancelado = r.estado === 'cancelado';
        return '<div class="mc-item"' + (r.asistio ? ' style="border-color:#10b981"' : '') + '><div class="mc-header"><label style="display:flex;align-items:center;gap:10px"><input type="checkbox" class="asist-check-reg" data-id="' + r.id + '" data-evento="' + eventoId + '"' + (r.asistio ? ' checked' : '') + (cancelado ? ' disabled' : '') + '><div class="mc-title">' + esc(r.nombre) + '</div></label><span class="estado-badge estado-' + r.estado + '">' + r.estado + '</span></div><div class="mc-row">📧 ' + esc(r.email) + '</div>' + (r.telefono ? '<div class="mc-row">📞 ' + esc(r.telefono) + '</div>' : '') + (r.asistio && r.fecha_asistencia ? '<div class="mc-row" style="color:var(--color-success)">✅ ' + new Date(r.fecha_asistencia).toLocaleString('es-PE') + '</div>' : '') + '<div class="mc-row" style="font-size:.75rem;color:var(--text-muted)">' + new Date(r.fecha_registro).toLocaleString('es-PE') + '</div><div class="mc-actions"><select class="estado-select" data-id="' + r.id + '" data-evento="' + eventoId + '" style="padding:6px 8px;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg-input);color:var(--text-primary);font-size:.78rem"><option value="pendiente"' + (r.estado==='pendiente'?' selected':'') + '>⏳ Pendiente</option><option value="confirmado"' + (r.estado==='confirmado'?' selected':'') + '>✅ Confirmado</option><option value="cancelado"' + (r.estado==='cancelado'?' selected':'') + '>❌ Cancelado</option></select><button class="btn btn-danger btn-xs" onclick="window._lumaDelReg(' + r.id + ',' + eventoId + ')">🗑️</button></div></div>';
      }).join('') +
      '</div></div></div>';
    panel.querySelectorAll('.estado-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          const res = await apiFetch('/admin/registros/' + sel.dataset.id + '/estado', { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ estado: sel.value }) });
          const data = await res.json();
          if (res.ok) { Toast.success('Estado actualizado'); cargarRegistros(sel.dataset.evento); }
          else Toast.error(data.error || 'Error');
        } catch { Toast.error('Error de conexión'); }
      });
    });
    panel.querySelectorAll('.asist-check-reg').forEach(chk => {
      chk.addEventListener('change', async () => {
        const asistio = chk.checked;
        chk.disabled = true;
        try {
          const res = await apiFetch('/admin/registros/' + chk.dataset.id + '/asistencia', {
            method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ asistio }),
          });
          const data = await res.json();
          if (res.ok) { Toast.success(data.message); cargarRegistros(chk.dataset.evento); }
          else { chk.checked = !asistio; Toast.error(data.error || 'Error'); }
        } catch { chk.checked = !asistio; Toast.error('Error de conexión'); }
        finally { chk.disabled = false; }
      });
    });
  }

  window._lumaVerReg = function (id) {
    const r = registrosActuales.find(x => x.id === id);
    if (!r) return;
    const itemLabel = r.item_nombre ? esc(r.item_nombre) : '—';
    document.getElementById('modal-registro-body').innerHTML = '<div class="detail-grid"><div><div class="detail-label">Nombre</div><div class="detail-value">' + esc(r.nombre) + '</div></div><div><div class="detail-label">Email</div><div class="detail-value">' + esc(r.email) + '</div></div><div><div class="detail-label">Teléfono</div><div class="detail-value">' + (r.telefono || '—') + '</div></div><div><div class="detail-label">Cuenta conmigo para</div><div class="detail-value">' + itemLabel + '</div></div><div><div class="detail-label">Estado</div><div class="detail-value"><span class="estado-badge estado-' + r.estado + '">' + r.estado + '</span></div></div><div><div class="detail-label">Asistió</div><div class="detail-value">' + (r.asistio ? '✅ Sí' : '— No') + '</div></div><div><div class="detail-label">Fecha registro</div><div class="detail-value">' + new Date(r.fecha_registro).toLocaleString('es-PE') + '</div></div></div>' + (r.fecha_asistencia ? '<div class="detail-full"><div class="detail-label">Hora asistencia</div><div class="detail-value">' + new Date(r.fecha_asistencia).toLocaleString('es-PE') + '</div></div>' : '') + (r.notas ? '<div class="detail-full"><div class="detail-label">Notas</div><div class="detail-value" style="margin-top:4px;line-height:1.6">' + esc(r.notas) + '</div></div>' : '');
    document.getElementById('modal-registro').classList.add('show');
  };

  window._lumaDelReg = async function (id, eventoId) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const res = await apiFetch('/admin/registros/' + id, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); cargarRegistros(eventoId); }
      else Toast.error(data.error || 'Error');
    } catch { Toast.error('Error de conexión'); }
  };

  function exportarCSV() {
    if (!registrosActuales.length) return;
    const headers = ['#','Nombre','Email','Teléfono','Cuenta conmigo','Estado','Asistió','Hora asistencia','Fecha registro','Notas'];
    const rows = registrosActuales.map((r, i) => [i+1, r.nombre, r.email, r.telefono||'', r.item_nombre||'', r.estado, r.asistio ? 'Sí' : 'No', r.fecha_asistencia ? new Date(r.fecha_asistencia).toLocaleString('es-PE') : '', new Date(r.fecha_registro).toLocaleString('es-PE'), r.notas||'']);
    const csv = [headers, ...rows].map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'registros-' + Date.now() + '.csv'; a.click();
  }

  // ── ADMINISTRADORES PAGE ──────────────────────────────────────────────────
  let adminsData = [];
  let rolesData = [];

  async function renderAdminsPage(el) {
    el.innerHTML = '<div class="filter-row"><button class="btn btn-primary btn-sm" id="btn-nuevo-admin" style="margin-left:auto">+ Nuevo administrador</button></div><div class="card"><div class="card-body"><div class="table-desktop"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Protegido</th><th>Creado</th><th>Acciones</th></tr></thead><tbody id="admins-tbody"></tbody></table></div><div class="mobile-cards" id="admins-mobile"></div></div></div>';
    document.getElementById('btn-nuevo-admin').addEventListener('click', () => abrirModalAdmin());
    await Promise.all([cargarAdmins(), cargarRoles()]);
  }

  async function cargarAdmins() {
    try {
      const res = await apiFetch('/admin/admins', { headers: authHeaders() });
      adminsData = await res.json();
      renderTablaAdmins(adminsData);
    } catch { Toast.error('Error al cargar administradores'); }
  }

  async function cargarRoles() {
    try {
      const res = await apiFetch('/admin/roles', { headers: authHeaders() });
      rolesData = await res.json();
    } catch {}
  }

  function renderTablaAdmins(lista) {
    const tbody = document.getElementById('admins-tbody');
    const mobile = document.getElementById('admins-mobile');
    if (!tbody) return;
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-empty"><div class="empty-icon">👤</div><div>Sin administradores</div></td></tr>'; mobile.innerHTML = ''; return; }
    tbody.innerHTML = lista.map(a => '<tr><td><strong>' + esc(a.nombre) + '</strong></td><td>' + esc(a.usuario) + '</td><td><span class="badge badge-activo">' + esc(a.rol) + '</span></td><td><span class="badge ' + (a.activo ? 'badge-activo' : 'badge-inactivo') + '">' + (a.activo ? 'Activo' : 'Inactivo') + '</span></td><td>' + (a.protegido ? '🔒 Sí' : '—') + '</td><td style="font-size:.8rem;color:var(--text-muted)">' + fmt(a.fecha_creacion) + '</td><td>' + (!a.protegido || user.protegido ? '<button class="btn btn-outline btn-xs" onclick="window._lumaEditAdmin(' + a.id + ')">✏️</button> <button class="btn btn-danger btn-xs" onclick="window._lumaDelAdmin(' + a.id + ',' + a.protegido + ')">🗑️</button>' : '<span style="font-size:.75rem;color:var(--text-muted)">Protegido</span>') + '</td></tr>').join('');
    mobile.innerHTML = lista.map(a => '<div class="mc-item"><div class="mc-header"><div class="mc-title">' + esc(a.nombre) + (a.protegido ? ' 🔒' : '') + '</div><span class="badge ' + (a.activo ? 'badge-activo' : 'badge-inactivo') + '">' + (a.activo ? 'Activo' : 'Inactivo') + '</span></div><div class="mc-row">👤 ' + esc(a.usuario) + '</div><div class="mc-row">🎭 ' + esc(a.rol) + '</div>' + (!a.protegido || user.protegido ? '<div class="mc-actions"><button class="btn btn-outline btn-xs" onclick="window._lumaEditAdmin(' + a.id + ')">✏️ Editar</button><button class="btn btn-danger btn-xs" onclick="window._lumaDelAdmin(' + a.id + ',' + a.protegido + ')">🗑️ Eliminar</button></div>' : '') + '</div>').join('');
  }

  let adminEditId = null;

  function abrirModalAdmin(id) {
    adminEditId = id || null;
    const a = id ? adminsData.find(x => x.id === id) : null;
    const modal = document.getElementById('modal-admin');
    document.getElementById('modal-admin-title').textContent = a ? '✏️ Editar Administrador' : '🧑💼 Nuevo Administrador';
    document.getElementById('af-nombre').value = a?.nombre || '';
    document.getElementById('af-usuario').value = a?.usuario || '';
    document.getElementById('af-password').value = '';
    document.getElementById('af-password').placeholder = a ? 'Dejar vacío para no cambiar' : 'Contraseña *';
    document.getElementById('af-activo').value = a ? (a.activo ? '1' : '0') : '1';
    const rolSel = document.getElementById('af-rol_id');
    rolSel.innerHTML = rolesData.map(r => '<option value="' + r.id + '"' + (a && a.rol_id === r.id ? ' selected' : '') + '>' + esc(r.nombre) + '</option>').join('');
    modal.classList.add('show');
  }

  window._lumaEditAdmin = abrirModalAdmin;
  window._lumaDelAdmin = async function (id, protegido) {
    if (protegido && !user.protegido) { Toast.error('No puedes eliminar al administrador protegido'); return; }
    if (!confirm('¿Eliminar este administrador?')) return;
    try {
      const res = await apiFetch('/admin/admins/' + id, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); cargarAdmins(); }
      else Toast.error(data.error || 'Error al eliminar');
    } catch { Toast.error('Error de conexión'); }
  };

  document.getElementById('btn-guardar-admin').addEventListener('click', async () => {
    const body = { nombre: document.getElementById('af-nombre').value, usuario: document.getElementById('af-usuario').value, password: document.getElementById('af-password').value, rol_id: document.getElementById('af-rol_id').value, activo: document.getElementById('af-activo').value };
    const url = adminEditId ? '/admin/admins/' + adminEditId : '/admin/admins';
    const method = adminEditId ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); document.getElementById('modal-admin').classList.remove('show'); cargarAdmins(); }
      else Toast.error(data.error || 'Error al guardar');
    } catch { Toast.error('Error de conexión'); }
  });

  // ── ROLES PAGE ────────────────────────────────────────────────────────────
  async function renderRolesPage(el) {
    el.innerHTML = '<div class="filter-row"><button class="btn btn-primary btn-sm" id="btn-nuevo-rol" style="margin-left:auto">+ Nuevo rol</button></div><div class="card"><div class="card-body"><div class="table-desktop"><table><thead><tr><th>Nombre</th><th>Descripción</th><th>Admins</th><th>Protegido</th><th>Creado</th><th>Acciones</th></tr></thead><tbody id="roles-tbody"></tbody></table></div><div class="mobile-cards" id="roles-mobile"></div></div></div>';
    document.getElementById('btn-nuevo-rol').addEventListener('click', () => abrirModalRol());
    await cargarRolesPage();
  }

  async function cargarRolesPage() {
    try {
      const res = await apiFetch('/admin/roles', { headers: authHeaders() });
      rolesData = await res.json();
      renderTablaRoles(rolesData);
    } catch { Toast.error('Error al cargar roles'); }
  }

  function renderTablaRoles(lista) {
    const tbody = document.getElementById('roles-tbody');
    const mobile = document.getElementById('roles-mobile');
    if (!tbody) return;
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><div class="empty-icon">🎭</div><div>Sin roles</div></td></tr>'; mobile.innerHTML = ''; return; }
    tbody.innerHTML = lista.map(r => '<tr><td><strong>' + esc(r.nombre) + '</strong></td><td style="color:var(--text-muted)">' + esc(r.descripcion || '—') + '</td><td>' + r.total_admins + '</td><td>' + (r.protegido ? '🔒 Sí' : '—') + '</td><td style="font-size:.8rem;color:var(--text-muted)">' + fmt(r.fecha_creacion) + '</td><td>' + (!r.protegido ? '<button class="btn btn-outline btn-xs" onclick="window._lumaEditRol(' + r.id + ')">✏️</button> <button class="btn btn-danger btn-xs" onclick="window._lumaDelRol(' + r.id + ')">🗑️</button>' : '<span style="font-size:.75rem;color:var(--text-muted)">Protegido</span>') + '</td></tr>').join('');
    mobile.innerHTML = lista.map(r => '<div class="mc-item"><div class="mc-header"><div class="mc-title">' + esc(r.nombre) + (r.protegido ? ' 🔒' : '') + '</div></div><div class="mc-row">' + esc(r.descripcion || '—') + '</div><div class="mc-row">👥 ' + r.total_admins + ' administrador(es)</div>' + (!r.protegido ? '<div class="mc-actions"><button class="btn btn-outline btn-xs" onclick="window._lumaEditRol(' + r.id + ')">✏️ Editar</button><button class="btn btn-danger btn-xs" onclick="window._lumaDelRol(' + r.id + ')">🗑️ Eliminar</button></div>' : '') + '</div>').join('');
  }

  let rolEditId = null;

  function abrirModalRol(id) {
    rolEditId = id || null;
    const r = id ? rolesData.find(x => x.id === id) : null;
    document.getElementById('modal-rol-title').textContent = r ? '✏️ Editar Rol' : '🎭 Nuevo Rol';
    document.getElementById('rf-nombre').value = r?.nombre || '';
    document.getElementById('rf-descripcion').value = r?.descripcion || '';
    document.getElementById('modal-rol').classList.add('show');
  }

  window._lumaEditRol = abrirModalRol;
  window._lumaDelRol = async function (id) {
    if (!confirm('¿Eliminar este rol?')) return;
    try {
      const res = await apiFetch('/admin/roles/' + id, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); cargarRolesPage(); }
      else Toast.error(data.error || 'Error al eliminar');
    } catch { Toast.error('Error de conexión'); }
  };

  document.getElementById('btn-guardar-rol').addEventListener('click', async () => {
    const body = { nombre: document.getElementById('rf-nombre').value, descripcion: document.getElementById('rf-descripcion').value };
    const url = rolEditId ? '/admin/roles/' + rolEditId : '/admin/roles';
    const method = rolEditId ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); document.getElementById('modal-rol').classList.remove('show'); cargarRolesPage(); }
      else Toast.error(data.error || 'Error al guardar');
    } catch { Toast.error('Error de conexión'); }
  });

  // ── ACCESOS PAGE ──────────────────────────────────────────────────────────
  async function renderAccesosPage(el) {
    el.innerHTML = '<p style="color:var(--text-muted);margin-bottom:16px;font-size:.85rem">Selecciona un rol para ver y editar los accesos asignados. El rol SUPERADMIN siempre tiene acceso total.</p><div class="filter-row"><select id="acc-rol-select" style="min-width:220px"><option value="">— Selecciona un rol —</option></select><button class="btn btn-primary btn-sm" id="btn-cargar-accesos">Ver accesos</button></div><div id="acc-panel"></div>';
    document.getElementById('btn-cargar-accesos').addEventListener('click', () => {
      const id = document.getElementById('acc-rol-select').value;
      if (!id) { Toast.error('Selecciona un rol'); return; }
      cargarAccesosRol(id);
    });
    try {
      const res = await apiFetch('/admin/roles', { headers: authHeaders() });
      const lista = await res.json();
      const sel = document.getElementById('acc-rol-select');
      lista.forEach(r => { const opt = document.createElement('option'); opt.value = r.id; opt.textContent = r.nombre + (r.protegido ? ' 🔒' : ''); sel.appendChild(opt); });
    } catch { Toast.error('Error al cargar roles'); }
  }

  async function cargarAccesosRol(rolId) {
    const panel = document.getElementById('acc-panel');
    panel.innerHTML = '<p style="color:var(--text-muted);padding:16px">Cargando...</p>';
    try {
      const [rolRes, accRes] = await Promise.all([
        apiFetch('/admin/roles', { headers: authHeaders() }),
        apiFetch('/admin/roles/' + rolId + '/accesos', { headers: authHeaders() }),
      ]);
      const roles = await rolRes.json();
      const accesos = await accRes.json();
      const rol = roles.find(r => r.id == rolId);
      const esProtegido = rol?.protegido;

      panel.innerHTML = '<div class="card"><div class="card-header"><h3>Accesos para: <strong>' + esc(rol?.nombre || '') + '</strong>' + (esProtegido ? ' 🔒' : '') + '</h3>' + (!esProtegido ? '<button class="btn btn-primary btn-sm" id="btn-guardar-accesos">💾 Guardar cambios</button>' : '') + '</div><div class="card-body" style="padding:20px"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px" id="acc-grid">' +
        accesos.map(a => '<label style="display:flex;align-items:flex-start;gap:10px;padding:14px;background:var(--bg-input);border-radius:10px;border:1px solid var(--border-color);cursor:' + (esProtegido ? 'default' : 'pointer') + '"><input type="checkbox" value="' + a.id + '"' + (a.asignado ? ' checked' : '') + (esProtegido ? ' disabled' : '') + ' style="margin-top:2px;width:16px;height:16px;accent-color:var(--color-primary);flex-shrink:0"><div><div style="font-weight:600;font-size:.88rem">' + esc(a.nombre) + '</div><div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">' + esc(a.descripcion || '') + '</div></div></label>').join('') +
        '</div></div></div>';

      if (!esProtegido) {
        document.getElementById('btn-guardar-accesos').addEventListener('click', async () => {
          const checked = Array.from(document.querySelectorAll('#acc-grid input[type=checkbox]:checked')).map(c => parseInt(c.value));
          try {
            const res = await apiFetch('/admin/roles/' + rolId + '/accesos', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ acceso_ids: checked }) });
            const data = await res.json();
            if (res.ok) Toast.success(data.message);
            else Toast.error(data.error || 'Error al guardar');
          } catch { Toast.error('Error de conexión'); }
        });
      }
    } catch { panel.innerHTML = '<p style="color:var(--color-danger);padding:16px">Error al cargar accesos</p>'; }
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  navigateTo(pageFromUrl());
})();
