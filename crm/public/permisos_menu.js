/* VHM CRM — permisos_menu.js (por usuario) */
(function () {
  'use strict';

  const { api, toast } = window.CRM;

  const ICON_MAP = {
    dashboard: 'fa-gauge-high', agenda: 'fa-calendar-days', calendario: 'fa-calendar-week',
    pacientes: 'fa-users', paquetes: 'fa-box', whatsapp: 'fa-whatsapp',
    mi_reporte: 'fa-chart-bar', disponibilidad: 'fa-clock', historial: 'fa-file-medical',
    encuestas: 'fa-poll', analitica: 'fa-chart-line', integraciones: 'fa-plug',
    terapeutas: 'fa-user-md', reportes: 'fa-chart-bar', permisos_menu: 'fa-shield-halved',
    leads: 'fa-funnel-dollar', marketing: 'fa-envelope', asignacion: 'fa-shuffle',
    consentimientos: 'fa-file-signature', espera: 'fa-hourglass-half',
  };
  const LABEL_MAP = {
    dashboard: 'Dashboard', agenda: 'Agenda', calendario: 'Calendario',
    pacientes: 'Pacientes', paquetes: 'Paquetes', whatsapp: 'Central WhatsApp',
    mi_reporte: 'Mi reporte', disponibilidad: 'Disponibilidad', historial: 'Historial clínico',
    encuestas: 'Encuestas', analitica: 'Analítica web', integraciones: 'Integraciones',
    terapeutas: 'Usuarios', reportes: 'Reportes', permisos_menu: 'Permisos de menú',
    leads: 'Leads', marketing: 'Email Marketing', asignacion: 'Asignación automática',
    consentimientos: 'Consentimientos', espera: 'Lista de espera',
  };

  let ITEMS = [];
  let users = [];
  let userActivo = null;

  async function load() {
    const [catalogData, usersData] = await Promise.all([
      api('/menu-permisos/catalogo'),
      api('/menu-permisos'),
    ]);
    ITEMS = (catalogData.items || []).map(key => ({
      key,
      label: LABEL_MAP[key] || key,
      icon: ICON_MAP[key] || 'fa-circle',
    }));
    users = usersData.users || [];
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
    const data = await api('/menu-permisos', {
      method: 'POST',
      body: { userId: userActivo.id, items },
      successMessage: 'Permisos guardados',
    });
    userActivo.items = data.items || items;
  }

  async function copyFromRol() {
    if (!userActivo) return;
    const data = await api('/menu-permisos/desde-rol', {
      method: 'POST',
      body: { userId: userActivo.id },
      successMessage: 'Plantilla del rol aplicada',
    });
    userActivo.items = data.items || [];
    render();
  }

  document.getElementById('btnGuardarPermisos').addEventListener('click', async () => {
    try { await save(); } catch (e) { toast(e.message, 'danger'); }
  });

  document.getElementById('btnCopiarRol').addEventListener('click', async () => {
    try { await copyFromRol(); } catch (e) { toast(e.message, 'danger'); }
  });

  load();
})();
