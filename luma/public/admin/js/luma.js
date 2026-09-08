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
  document.getElementById('user-rol').textContent = user.rol === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrador';
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
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  const Toast = {
    show(msg, type) {
      const icons = { success: '✅', error: '❌', info: 'ℹ️' };
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${esc(msg)}</span><button class="toast-close">✕</button>`;
      el.querySelector('.toast-close').addEventListener('click', () => remove(el));
      document.getElementById('toast-container').appendChild(el);
      setTimeout(() => remove(el), 4000);
    },
    success(m) { this.show(m, 'success'); },
    error(m) { this.show(m, 'error'); },
    info(m) { this.show(m, 'info'); },
  };
  function remove(el) {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }

  // ── SIDEBAR / HAMBURGER ───────────────────────────────────────────────────
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  document.getElementById('btn-hamburger').addEventListener('click', () => {
    sidebar.classList.toggle('open'); overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); });

  // ── MODALES ───────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.modalClose).classList.remove('show'));
  });
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('show'); });
  });

  // ── NAVEGACIÓN ────────────────────────────────────────────────────────────
  const titles = { dashboard: '📊 Dashboard', eventos: '📋 Eventos', registros: '👥 Registros' };
  let currentPage = 'dashboard';

  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sidebar.classList.remove('open'); overlay.classList.remove('show');
      navigateTo(btn.dataset.page);
    });
  });

  function navigateTo(page) {
    currentPage = page;
    document.getElementById('page-title').textContent = titles[page] || page;
    const content = document.getElementById('main-content');
    if (page === 'dashboard') renderDashboard(content);
    else if (page === 'eventos') renderEventosPage(content);
    else if (page === 'registros') renderRegistrosPage(content);
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function fmt(fecha) {
    if (!fecha) return '';
    const [y, m, d] = fecha.split('T')[0].split('-');
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return `${parseInt(d)} ${meses[parseInt(m)-1]} ${y}`;
  }
  function fmtHora(h) { return h ? h.slice(0,5) : ''; }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  async function renderDashboard(el) {
    el.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Eventos activos</div><div class="stat-value" id="st-eventos">—</div></div>
        <div class="stat-card"><div class="stat-label">Próximos</div><div class="stat-value" id="st-proximos">—</div></div>
        <div class="stat-card"><div class="stat-label">Total registros</div><div class="stat-value" id="st-registros">—</div></div>
        <div class="stat-card"><div class="stat-label">Confirmados</div><div class="stat-value" id="st-confirmados">—</div></div>
      </div>
      <div class="section-header" style="margin-top:8px">
        <div><h2>Próximos eventos</h2><p>Eventos activos ordenados por fecha</p></div>
        <button class="btn btn-primary btn-sm" id="btn-dash-nuevo">+ Nuevo evento</button>
      </div>
      <div id="dash-eventos-list"></div>`;

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
      document.getElementById('st-confirmados').textContent = stats.confirmados ?? '—';

      const proximos = eventos.filter(e => e.activo && e.fecha >= new Date().toISOString().split('T')[0]).slice(0, 5);
      const list = document.getElementById('dash-eventos-list');
      if (!proximos.length) {
        list.innerHTML = '<div class="card"><div class="card-body"><p style="padding:24px;text-align:center;color:var(--text-muted)">Sin eventos próximos</p></div></div>';
        return;
      }
      list.innerHTML = `<div class="card"><div class="card-body"><div class="table-desktop"><table>
        <thead><tr><th>Nombre</th><th>Fecha</th><th>Lugar</th><th>Registrados</th><th>Capacidad</th></tr></thead>
        <tbody>${proximos.map(e => {
          const pct = e.capacidad ? Math.min(100, Math.round((e.registrados / e.capacidad) * 100)) : null;
          return `<tr>
            <td><strong>${esc(e.nombre)}</strong></td>
            <td>${fmt(e.fecha)}</td>
            <td>${esc(e.lugar)}</td>
            <td><strong>${e.registrados}</strong>${pct !== null ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}</td>
            <td>${e.capacidad || '∞'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div></div>`;
    } catch { Toast.error('Error al cargar datos'); }
  }

  // ── EVENTOS PAGE ──────────────────────────────────────────────────────────
  let eventosData = [];

  async function renderEventosPage(el) {
    el.innerHTML = `
      <div class="filter-row">
        <input type="text" id="evt-search" placeholder="Buscar evento..." style="width:200px">
        <button class="btn btn-primary btn-sm" id="btn-buscar-evt">🔍 Buscar</button>
        <button class="btn btn-primary btn-sm" id="btn-nuevo-evento" style="margin-left:auto">+ Nuevo evento</button>
      </div>
      <div class="card">
        <div class="card-body">
          <div class="table-desktop">
            <table>
              <thead><tr><th>Nombre</th><th>Fecha</th><th>Horario</th><th>Lugar</th><th>Registrados</th><th>Capacidad</th><th>Activo</th><th>Acciones</th></tr></thead>
              <tbody id="evt-tbody"></tbody>
            </table>
          </div>
          <div class="mobile-cards" id="evt-mobile"></div>
        </div>
      </div>`;

    document.getElementById('btn-nuevo-evento').addEventListener('click', () => abrirModalEvento());
    document.getElementById('btn-buscar-evt').addEventListener('click', () => {
      const q = document.getElementById('evt-search').value.trim().toLowerCase();
      renderTablaEventos(q ? eventosData.filter(e => e.nombre.toLowerCase().includes(q) || e.lugar.toLowerCase().includes(q)) : eventosData);
    });
    document.getElementById('evt-search').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-buscar-evt').click(); });

    await cargarEventos();
  }

  async function cargarEventos() {
    try {
      const res = await apiFetch('/admin/eventos', { headers: authHeaders() });
      eventosData = await res.json();
      renderTablaEventos(eventosData);
    } catch { Toast.error('Error al cargar eventos'); }
  }

  function renderTablaEventos(lista) {
    const tbody = document.getElementById('evt-tbody');
    const mobile = document.getElementById('evt-mobile');
    if (!tbody) return;
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty"><div class="empty-icon">📭</div><div>Sin eventos</div></td></tr>';
      mobile.innerHTML = ''; return;
    }
    tbody.innerHTML = lista.map(e => {
      const pct = e.capacidad ? Math.min(100, Math.round((e.registrados / e.capacidad) * 100)) : null;
      return `<tr>
        <td><strong>${esc(e.nombre)}</strong></td>
        <td>${fmt(e.fecha)}</td>
        <td>${fmtHora(e.hora_inicio)}${e.hora_fin ? ' – ' + fmtHora(e.hora_fin) : ''}</td>
        <td>${esc(e.lugar)}</td>
        <td><strong>${e.registrados}</strong>${pct !== null ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}</td>
        <td>${e.capacidad || '∞'}</td>
        <td><span class="badge ${e.activo ? 'badge-activo' : 'badge-inactivo'}">${e.activo ? 'Sí' : 'No'}</span></td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="window._lumaEditEvento(${e.id})">✏️</button>
          <button class="btn btn-danger btn-xs" onclick="window._lumaDelEvento(${e.id})">🗑️</button>
        </td>
      </tr>`;
    }).join('');
    mobile.innerHTML = lista.map(e => `
      <div class="mc-item">
        <div class="mc-header"><div class="mc-title">${esc(e.nombre)}</div><span class="badge ${e.activo ? 'badge-activo' : 'badge-inactivo'}">${e.activo ? 'Activo' : 'Inactivo'}</span></div>
        <div class="mc-row">📅 ${fmt(e.fecha)} · 🕐 ${fmtHora(e.hora_inicio)}</div>
        <div class="mc-row">📍 ${esc(e.lugar)}</div>
        <div class="mc-row">👥 ${e.registrados} registrados${e.capacidad ? ' / ' + e.capacidad : ''}</div>
        <div class="mc-actions">
          <button class="btn btn-outline btn-xs" onclick="window._lumaEditEvento(${e.id})">✏️ Editar</button>
          <button class="btn btn-danger btn-xs" onclick="window._lumaDelEvento(${e.id})">🗑️ Eliminar</button>
        </div>
      </div>`).join('');
  }

  // ── MODAL EVENTO ──────────────────────────────────────────────────────────
  let eventoEditId = null;

  function abrirModalEvento(id) {
    eventoEditId = id || null;
    const e = id ? eventosData.find(x => x.id === id) : null;
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
    document.getElementById('modal-evento').classList.add('show');
  }

  window._lumaEditEvento = abrirModalEvento;
  window._lumaDelEvento = async function (id) {
    if (!confirm('¿Eliminar este evento y todos sus registros?')) return;
    try {
      const res = await apiFetch(`/admin/eventos/${id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); if (currentPage === 'eventos') cargarEventos(); }
      else Toast.error(data.error || 'Error al eliminar');
    } catch { Toast.error('Error de conexión'); }
  };

  document.getElementById('btn-guardar-evento').addEventListener('click', async () => {
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
    };
    const url = eventoEditId ? `/admin/eventos/${eventoEditId}` : '/admin/eventos';
    const method = eventoEditId ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        Toast.success(data.message);
        document.getElementById('modal-evento').classList.remove('show');
        if (currentPage === 'eventos') cargarEventos();
        else if (currentPage === 'dashboard') navigateTo('dashboard');
      } else Toast.error(data.error || 'Error al guardar');
    } catch { Toast.error('Error de conexión'); }
  });

  // ── REGISTROS PAGE ────────────────────────────────────────────────────────
  let registrosActuales = [];

  async function renderRegistrosPage(el) {
    el.innerHTML = `
      <div class="filter-row">
        <select id="reg-evento-select" style="min-width:240px"><option value="">— Selecciona un evento —</option></select>
        <button class="btn btn-primary btn-sm" id="btn-cargar-reg">Ver registros</button>
        <button class="btn btn-outline btn-sm" id="btn-exportar-csv" style="margin-left:auto" disabled>⬇️ Exportar CSV</button>
      </div>
      <div id="reg-panel"></div>`;

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
      lista.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${e.nombre} (${fmt(e.fecha)}) — ${e.registrados} registros`;
        sel.appendChild(opt);
      });
    } catch { Toast.error('Error al cargar eventos'); }
  }

  async function cargarRegistros(eventoId) {
    const panel = document.getElementById('reg-panel');
    panel.innerHTML = '<p style="color:var(--text-muted);padding:16px">Cargando...</p>';
    try {
      const res = await apiFetch(`/admin/eventos/${eventoId}/registros`, { headers: authHeaders() });
      registrosActuales = await res.json();
      const csvBtn = document.getElementById('btn-exportar-csv');
      if (csvBtn) csvBtn.disabled = !registrosActuales.length;
      renderTablaRegistros(registrosActuales, eventoId);
    } catch { panel.innerHTML = '<p style="color:var(--color-danger);padding:16px">Error al cargar registros</p>'; }
  }

  function renderTablaRegistros(lista, eventoId) {
    const panel = document.getElementById('reg-panel');
    const confirmados = lista.filter(r => r.estado === 'confirmado').length;
    const pendientes = lista.filter(r => r.estado === 'pendiente').length;
    const cancelados = lista.filter(r => r.estado === 'cancelado').length;

    if (!lista.length) {
      panel.innerHTML = '<div class="card"><div class="card-body"><p style="padding:32px;text-align:center;color:var(--text-muted)">📭 Sin registros para este evento</p></div></div>';
      return;
    }

    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value" style="color:var(--color-warning)">${pendientes}</div></div>
        <div class="stat-card"><div class="stat-label">Confirmados</div><div class="stat-value" style="color:var(--color-success)">${confirmados}</div></div>
        <div class="stat-card"><div class="stat-label">Cancelados</div><div class="stat-value" style="color:var(--color-danger)">${cancelados}</div></div>
      </div>
      <div class="card"><div class="card-body">
        <div class="table-desktop"><table>
          <thead><tr><th>#</th><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Estado</th><th>Fecha registro</th><th>Acciones</th></tr></thead>
          <tbody>${lista.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(r.nombre)}</strong></td>
              <td>${esc(r.email)}</td>
              <td>${r.telefono ? esc(r.telefono) : '<span style="color:var(--text-muted)">—</span>'}</td>
              <td>
                <select class="estado-select" data-id="${r.id}" data-evento="${eventoId}"
                  style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg-input);color:var(--text-primary);font-size:.78rem">
                  <option value="pendiente" ${r.estado==='pendiente'?'selected':''}>⏳ Pendiente</option>
                  <option value="confirmado" ${r.estado==='confirmado'?'selected':''}>✅ Confirmado</option>
                  <option value="cancelado" ${r.estado==='cancelado'?'selected':''}>❌ Cancelado</option>
                </select>
              </td>
              <td style="font-size:.8rem;color:var(--text-muted)">${new Date(r.fecha_registro).toLocaleString('es-PE')}</td>
              <td>
                ${r.notas ? `<button class="btn btn-outline btn-xs" onclick="window._lumaVerReg(${r.id})">👁️</button>` : ''}
                <button class="btn btn-danger btn-xs" onclick="window._lumaDelReg(${r.id}, ${eventoId})">🗑️</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="mobile-cards">${lista.map(r => `
          <div class="mc-item">
            <div class="mc-header"><div class="mc-title">${esc(r.nombre)}</div><span class="estado-badge estado-${r.estado}">${r.estado}</span></div>
            <div class="mc-row">📧 ${esc(r.email)}</div>
            ${r.telefono ? `<div class="mc-row">📞 ${esc(r.telefono)}</div>` : ''}
            <div class="mc-row" style="font-size:.75rem;color:var(--text-muted)">${new Date(r.fecha_registro).toLocaleString('es-PE')}</div>
            <div class="mc-actions">
              <select class="estado-select" data-id="${r.id}" data-evento="${eventoId}"
                style="padding:6px 8px;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg-input);color:var(--text-primary);font-size:.78rem">
                <option value="pendiente" ${r.estado==='pendiente'?'selected':''}>⏳ Pendiente</option>
                <option value="confirmado" ${r.estado==='confirmado'?'selected':''}>✅ Confirmado</option>
                <option value="cancelado" ${r.estado==='cancelado'?'selected':''}>❌ Cancelado</option>
              </select>
              <button class="btn btn-danger btn-xs" onclick="window._lumaDelReg(${r.id}, ${eventoId})">🗑️</button>
            </div>
          </div>`).join('')}
        </div>
      </div></div>`;

    panel.querySelectorAll('.estado-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          const res = await apiFetch(`/admin/registros/${sel.dataset.id}/estado`, {
            method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ estado: sel.value }),
          });
          const data = await res.json();
          if (res.ok) { Toast.success('Estado actualizado'); cargarRegistros(sel.dataset.evento); }
          else Toast.error(data.error || 'Error');
        } catch { Toast.error('Error de conexión'); }
      });
    });
  }

  window._lumaVerReg = function (id) {
    const r = registrosActuales.find(x => x.id === id);
    if (!r) return;
    document.getElementById('modal-registro-body').innerHTML = `
      <div class="detail-grid">
        <div><div class="detail-label">Nombre</div><div class="detail-value">${esc(r.nombre)}</div></div>
        <div><div class="detail-label">Email</div><div class="detail-value">${esc(r.email)}</div></div>
        <div><div class="detail-label">Teléfono</div><div class="detail-value">${r.telefono || '—'}</div></div>
        <div><div class="detail-label">Estado</div><div class="detail-value"><span class="estado-badge estado-${r.estado}">${r.estado}</span></div></div>
        <div><div class="detail-label">Fecha registro</div><div class="detail-value">${new Date(r.fecha_registro).toLocaleString('es-PE')}</div></div>
      </div>
      ${r.notas ? `<div class="detail-full"><div class="detail-label">Notas</div><div class="detail-value" style="margin-top:4px;line-height:1.6">${esc(r.notas)}</div></div>` : ''}`;
    document.getElementById('modal-registro').classList.add('show');
  };

  window._lumaDelReg = async function (id, eventoId) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const res = await apiFetch(`/admin/registros/${id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { Toast.success(data.message); cargarRegistros(eventoId); }
      else Toast.error(data.error || 'Error');
    } catch { Toast.error('Error de conexión'); }
  };

  function exportarCSV() {
    if (!registrosActuales.length) return;
    const headers = ['#','Nombre','Email','Teléfono','Estado','Fecha registro','Notas'];
    const rows = registrosActuales.map((r, i) => [
      i + 1, r.nombre, r.email, r.telefono || '', r.estado,
      new Date(r.fecha_registro).toLocaleString('es-PE'), r.notas || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `registros-${Date.now()}.csv`;
    a.click();
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  navigateTo('dashboard');
})();
