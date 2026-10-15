/* VHM CRM — permisos_menu.js (por usuario) */
(function () {
  'use strict';

  const { api, toast } = window.CRM;
  const CATS_KEY = 'crm-permisos-menu-cerradas';

  let CATEGORIAS = [];
  let users = [];
  let userActivo = null;

  function panel() { return document.getElementById('permisosPanel'); }

  async function load() {
    const [catalogData, usersData] = await Promise.all([
      api('/menu-permisos/catalogo'),
      api('/menu-permisos'),
    ]);
    CATEGORIAS = catalogData.categorias || [];
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
      panel().innerHTML = '';
      return;
    }
    meta.textContent = `Rol: ${userActivo.rol} · Usuario: ${userActivo.username}`;
    render();
  }

  function leerCerradas() {
    try {
      const raw = localStorage.getItem(CATS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(c => typeof c === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function guardarCerradas(lista) {
    try { localStorage.setItem(CATS_KEY, JSON.stringify([...new Set(lista)])); } catch (e) {}
  }

  function itemHtml(item, activos, sub) {
    return `
          <label class="perm-item${sub ? ' perm-item-sub' : ''}">
            <input type="checkbox" data-item="${item.clave}" ${activos.has(item.clave) ? 'checked' : ''}>
            <i class="${item.icon}" aria-hidden="true"></i>
            <span>${item.label}</span>
          </label>`;
  }

  function grupoHtml(grupo, activos) {
    const claves = grupo.hijos.map(h => h.clave).join(',');
    return `
          <label class="perm-item perm-item-grupo">
            <input type="checkbox" data-grupo="1" data-item="${grupo.clave}" data-hijos="${claves}">
            <i class="${grupo.icon}" aria-hidden="true"></i>
            <span>${grupo.label}</span>
          </label>
          ${grupo.hijos.map(h => itemHtml(h, activos, true)).join('')}`;
  }

  function categoriaHtml(cat, activos, cerradas) {
    const abierta = !cerradas.has(cat.clave);
    const cuerpoId = `perm-cat-${cat.clave}`;
    const cuerpo = cat.items.map(it => (it.grupo ? grupoHtml(it, activos) : itemHtml(it, activos, false))).join('');
    return `
      <section class="perm-cat" data-cat="${cat.clave}">
        <button type="button" class="perm-cat-toggle" aria-expanded="${abierta ? 'true' : 'false'}" aria-controls="${cuerpoId}">
          <span class="perm-cat-label">${cat.label}</span>
          <i class="fas fa-chevron-down perm-cat-chevron" aria-hidden="true"></i>
        </button>
        <div class="perm-cat-items" id="${cuerpoId}"${abierta ? '' : ' hidden'}>${cuerpo}</div>
      </section>`;
  }

  function hojasMarcadas() {
    return new Set([...panel().querySelectorAll('input[data-item]:checked')]
      .filter(el => !el.dataset.grupo).map(el => el.dataset.item));
  }

  function refrescarPadres() {
    const marcados = hojasMarcadas();
    panel().querySelectorAll('input[data-grupo]').forEach(p => {
      const estado = window.MenuGruposUI.estadoPadre(marcados, p.dataset.hijos.split(','));
      p.checked = estado === 'marcado';
      p.indeterminate = estado === 'indeterminado';
    });
  }

  function render() {
    if (!userActivo) return;
    const activos = new Set(userActivo.items || []);
    const cerradas = new Set(leerCerradas());
    panel().innerHTML = CATEGORIAS.map(cat => categoriaHtml(cat, activos, cerradas)).join('');
    refrescarPadres();
  }

  async function save() {
    if (!userActivo) return;
    const items = [...panel().querySelectorAll('input[data-item]:checked')]
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

  panel().addEventListener('click', e => {
    const boton = e.target.closest('.perm-cat-toggle');
    if (!boton) return;
    const abierta = boton.getAttribute('aria-expanded') !== 'true';
    boton.setAttribute('aria-expanded', abierta ? 'true' : 'false');
    const cuerpo = document.getElementById(boton.getAttribute('aria-controls'));
    if (cuerpo) cuerpo.hidden = !abierta;
    const clave = boton.closest('.perm-cat').dataset.cat;
    const cerradas = new Set(leerCerradas());
    if (abierta) cerradas.delete(clave); else cerradas.add(clave);
    guardarCerradas([...cerradas]);
  });

  panel().addEventListener('change', e => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.dataset.item) return;
    if (el.dataset.grupo) {
      const hijos = el.dataset.hijos.split(',');
      const marcados = window.MenuGruposUI.aplicarPadre(hojasMarcadas(), hijos, el.checked);
      hijos.forEach(h => {
        const hijo = panel().querySelector(`input[data-item="${h}"]`);
        if (hijo) hijo.checked = marcados.has(h);
      });
    }
    refrescarPadres();
  });

  document.getElementById('btnGuardarPermisos').addEventListener('click', async () => {
    try { await save(); } catch (e) { toast(e.message, 'danger'); }
  });

  document.getElementById('btnCopiarRol').addEventListener('click', async () => {
    try { await copyFromRol(); } catch (e) { toast(e.message, 'danger'); }
  });

  load();
})();
