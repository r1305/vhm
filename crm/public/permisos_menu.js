/* VHM CRM — permisos_menu.js (por usuario) */
(function () {
  'use strict';

  const { api, toast } = window.CRM;

  let ITEMS = [];
  let GRUPOS = {};
  let users = [];
  let userActivo = null;

  async function load() {
    const [catalogData, usersData] = await Promise.all([
      api('/menu-permisos/catalogo'),
      api('/menu-permisos'),
    ]);
    ITEMS = (catalogData.items || []).map(i => ({
      key: i.clave,
      label: i.label,
      icon: i.icon || 'fa-circle',
    }));
    GRUPOS = catalogData.grupos || {};
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

  function itemHtml(item, activos, extra) {
    const sub = extra && extra.sub;
    return `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;${sub ? 'margin-left:24px;' : ''}border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--card-bg)">
            <input type="checkbox" data-item="${item.key}" ${sub ? `data-padre="${extra.padre}"` : ''} ${activos.has(item.key) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
            <i class="fas ${item.icon}" style="width:16px;color:var(--primary)"></i>
            <span style="font-size:13px">${item.label}</span>
          </label>`;
  }

  function sincronizarHijos() {
    document.querySelectorAll('#permisosPanel input[data-padre]').forEach(h => {
      const padre = document.querySelector(`#permisosPanel input[data-item="${h.dataset.padre}"]`);
      h.disabled = !!(padre && padre.checked);
    });
  }

  function render() {
    if (!userActivo) return;
    const activos = new Set(userActivo.items || []);
    const hijoDe = {};
    Object.entries(GRUPOS).forEach(([padre, hijos]) => hijos.forEach(h => { hijoDe[h] = padre; }));
    const porClave = Object.fromEntries(ITEMS.map(i => [i.key, i]));
    const html = [];
    ITEMS.forEach(item => {
      if (hijoDe[item.key] && porClave[hijoDe[item.key]]) return;
      html.push(itemHtml(item, activos));
      (GRUPOS[item.key] || []).forEach(k => {
        if (porClave[k]) html.push(itemHtml(porClave[k], activos, { sub: true, padre: item.key }));
      });
    });
    const panel = document.getElementById('permisosPanel');
    panel.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${html.join('')}</div>`;
    panel.querySelectorAll('input[data-item]').forEach(el => {
      if (GRUPOS[el.dataset.item]) el.addEventListener('change', sincronizarHijos);
    });
    sincronizarHijos();
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
