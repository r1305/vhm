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
    const attrs = sub ? `data-padre="${extra.padre}"` : (extra && extra.grupo ? 'data-grupo="1"' : 'data-item-hoja="1"');
    return `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;${sub ? 'margin-left:24px;' : ''}border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--card-bg)">
            <input type="checkbox" data-item="${item.key}" ${attrs} ${activos.has(item.key) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
            <i class="fas ${item.icon}" style="width:16px;color:var(--primary)"></i>
            <span style="font-size:13px">${item.label}</span>
          </label>`;
  }

  function hojasMarcadas() {
    return new Set([...document.querySelectorAll('#permisosPanel input[data-item]:checked')]
      .filter(el => !el.dataset.grupo).map(el => el.dataset.item));
  }

  function refrescarPadres() {
    const marcados = hojasMarcadas();
    document.querySelectorAll('#permisosPanel input[data-grupo]').forEach(p => {
      const g = GRUPOS[p.dataset.item];
      const estado = window.MenuGruposUI.estadoPadre(marcados, g.hijos);
      p.checked = estado === 'marcado';
      p.indeterminate = estado === 'indeterminado';
    });
  }

  function render() {
    if (!userActivo) return;
    const activos = new Set(userActivo.items || []);
    const hijoDe = {};
    Object.entries(GRUPOS).forEach(([padre, g]) => g.hijos.forEach(h => { hijoDe[h] = padre; }));
    const porClave = Object.fromEntries(ITEMS.map(i => [i.key, i]));
    const html = [];
    const emitidos = new Set();
    ITEMS.forEach(item => {
      const padre = hijoDe[item.key];
      if (!padre) { html.push(itemHtml(item, activos)); return; }
      if (emitidos.has(padre)) return;
      emitidos.add(padre);
      const g = GRUPOS[padre];
      html.push(itemHtml({ key: padre, label: g.label, icon: g.icon }, new Set(), { grupo: true }));
      g.hijos.forEach(k => {
        if (porClave[k]) html.push(itemHtml(porClave[k], activos, { sub: true, padre }));
      });
    });
    const panel = document.getElementById('permisosPanel');
    panel.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${html.join('')}</div>`;
    panel.querySelectorAll('input[data-grupo]').forEach(p => {
      p.addEventListener('change', () => {
        const g = GRUPOS[p.dataset.item];
        const marcados = window.MenuGruposUI.aplicarPadre(hojasMarcadas(), g.hijos, p.checked);
        g.hijos.forEach(h => {
          const el = panel.querySelector(`input[data-item="${h}"]`);
          if (el) el.checked = marcados.has(h);
        });
        refrescarPadres();
      });
    });
    panel.querySelectorAll('input[data-padre]').forEach(h => h.addEventListener('change', refrescarPadres));
    refrescarPadres();
  }

  async function save() {
    if (!userActivo) return;
    const items = [...document.querySelectorAll('#permisosPanel input[data-item]:checked')]
      .filter(el => !el.dataset.grupo).map(el => el.dataset.item);
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
