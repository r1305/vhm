/* VHM CRM — permisos_menu.js (por usuario) */
(function () {
  'use strict';

  const { toast } = window.CRM;
  const BASE = window.__APP_BASE__;

  const ITEMS = [
    { key: 'dashboard',       label: 'Dashboard',          icon: 'fa-gauge-high' },
    { key: 'agenda',          label: 'Agenda',             icon: 'fa-calendar-days' },
    { key: 'calendario',      label: 'Calendario',         icon: 'fa-calendar-week' },
    { key: 'pacientes',       label: 'Pacientes',          icon: 'fa-users' },
    { key: 'whatsapp',        label: 'Central WhatsApp',   icon: 'fa-whatsapp' },
    { key: 'mi_reporte',      label: 'Mi reporte',         icon: 'fa-chart-bar' },
    { key: 'disponibilidad',  label: 'Disponibilidad',     icon: 'fa-clock' },
    { key: 'historial',       label: 'Historial clínico',  icon: 'fa-file-medical' },
    { key: 'analitica',       label: 'Analítica web',      icon: 'fa-chart-line' },
    { key: 'integraciones',   label: 'Integraciones',      icon: 'fa-plug' },
    { key: 'terapeutas',      label: 'Usuarios',           icon: 'fa-user-md' },
    { key: 'reportes',        label: 'Reportes',           icon: 'fa-chart-bar' },
    { key: 'permisos_menu',   label: 'Permisos de menú',   icon: 'fa-shield-halved' },
  ];

  let users = [];
  let userActivo = null;

  async function load() {
    const res = await fetch(`${BASE}/api/menu-permisos`, { credentials: 'same-origin' });
    const data = await res.json();
    users = data.users || [];
    renderUserSelect();
    if (users.length) selectUser(users[0].id);
  }

  function renderUserSelect() {
    const select = document.getElementById('permUserSelect');
    select.innerHTML = users.map(u => {
      const name = `${u.nombre} ${u.apellido}`.trim();
      const estado = u.activo ? '' : ' (inactivo)';
      return `<option value="${u.id}">${name} — @${u.username} [${u.rol}]${estado}</option>`;
    }).join('');
    select.addEventListener('change', () => selectUser(parseInt(select.value, 10)));
  }

  function selectUser(id) {
    userActivo = users.find(u => u.id === id) || null;
    const select = document.getElementById('permUserSelect');
    if (select && userActivo) select.value = String(userActivo.id);

    const meta = document.getElementById('permUserMeta');
    if (!userActivo) {
      meta.textContent = '';
      document.getElementById('permisosPanel').innerHTML = '';
      return;
    }
    meta.textContent = `Rol: ${userActivo.rol} · Usuario: ${userActivo.username}`;
    render();
  }

  function render() {
    if (!userActivo) return;
    const activos = new Set(userActivo.items || []);
    document.getElementById('permisosPanel').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${ITEMS.map(item => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--card-bg)">
            <input type="checkbox" data-item="${item.key}" ${activos.has(item.key) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
            <i class="fas ${item.icon}" style="width:16px;color:var(--primary)"></i>
            <span style="font-size:13px">${item.label}</span>
          </label>`).join('')}
      </div>`;
  }

  async function save() {
    if (!userActivo) return;
    const items = [...document.querySelectorAll('#permisosPanel input[data-item]:checked')]
      .map(el => el.dataset.item);
    const res = await fetch(`${BASE}/api/menu-permisos`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userActivo.id, items }),
    });
    if (!res.ok) throw new Error('Error al guardar');
    const data = await res.json();
    userActivo.items = data.items || items;
    toast('Permisos guardados');
  }

  async function copyFromRol() {
    if (!userActivo) return;
    const res = await fetch(`${BASE}/api/menu-permisos/desde-rol`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userActivo.id }),
    });
    if (!res.ok) throw new Error('Error al copiar plantilla');
    const data = await res.json();
    userActivo.items = data.items || [];
    render();
    toast('Plantilla del rol aplicada');
  }

  document.getElementById('btnGuardarPermisos').addEventListener('click', async () => {
    try { await save(); } catch (e) { toast(e.message, 'danger'); }
  });

  document.getElementById('btnCopiarRol').addEventListener('click', async () => {
    try { await copyFromRol(); } catch (e) { toast(e.message, 'danger'); }
  });

  load();
})();
