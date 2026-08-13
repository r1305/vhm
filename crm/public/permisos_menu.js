/* VHM CRM — permisos_menu.js */
(function () {
  'use strict';

  const { toast } = window.CRM;
  const BASE = window.__APP_BASE__;

  const ITEMS = [
    { key: 'dashboard',       label: 'Dashboard',          icon: 'fa-gauge-high' },
    { key: 'agenda',          label: 'Agenda',             icon: 'fa-calendar-days' },
    { key: 'pacientes',       label: 'Pacientes',          icon: 'fa-users' },
    { key: 'mi_reporte',      label: 'Mi reporte',         icon: 'fa-chart-bar' },
    { key: 'leads',           label: 'Leads',              icon: 'fa-bullseye' },
    { key: 'historial',       label: 'Historial clínico',  icon: 'fa-file-medical' },
    { key: 'consentimientos', label: 'Consentimientos',    icon: 'fa-file-signature' },
    { key: 'pagos',           label: 'Pagos',              icon: 'fa-credit-card' },
    { key: 'espera',          label: 'Lista de espera',    icon: 'fa-hourglass-half' },
    { key: 'analitica',       label: 'Analítica web',      icon: 'fa-chart-line' },
    { key: 'marketing',       label: 'Marketing',          icon: 'fa-envelope-open-text' },
    { key: 'asignacion',      label: 'Asignación auto',    icon: 'fa-sitemap' },
    { key: 'integraciones',   label: 'Integraciones',      icon: 'fa-plug' },
    { key: 'terapeutas',      label: 'Terapeutas',         icon: 'fa-user-md' },
    { key: 'reportes',        label: 'Reportes',           icon: 'fa-chart-bar' },
  ];

  let permisos = {};
  let rolActivo = 'recepcion';

  async function load() {
    const res = await fetch(`${BASE}/api/menu-permisos`, { credentials: 'same-origin' });
    permisos = await res.json();
    render();
  }

  function render() {
    const activos = new Set(permisos[rolActivo] || []);
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
    const items = [...document.querySelectorAll('#permisosPanel input[data-item]:checked')]
      .map(el => el.dataset.item);
    const res = await fetch(`${BASE}/api/menu-permisos`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: rolActivo, items }),
    });
    if (!res.ok) throw new Error('Error al guardar');
    permisos[rolActivo] = items;
    toast('Permisos guardados');
  }

  document.querySelectorAll('[data-rol]').forEach(btn => {
    btn.addEventListener('click', () => {
      rolActivo = btn.dataset.rol;
      document.querySelectorAll('[data-rol]').forEach(b => b.classList.replace('btn-primary', 'btn-outline'));
      btn.classList.replace('btn-outline', 'btn-primary');
      render();
    });
  });

  document.getElementById('btnGuardarPermisos').addEventListener('click', async () => {
    try { await save(); } catch (e) { toast(e.message, 'danger'); }
  });

  load();
})();
