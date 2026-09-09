(function () {
  const panel = document.getElementById('accesos-panel');
  const select = document.getElementById('acc-user-select');
  const meta = document.getElementById('acc-user-meta');
  const btnGuardar = document.getElementById('btn-guardar-accesos');

  let catalog = [];
  let users = [];
  let userActivo = null;

  AdminLayout.init({ page: 'accesos', title: '🔐 Accesos', requireSuperAdmin: true }).then(function (ok) {
    if (!ok) return;
    cargar();
  });

  btnGuardar.addEventListener('click', guardar);

  async function cargar() {
    panel.innerHTML = '<p style="padding:20px;color:var(--text-muted)">Cargando...</p>';
    try {
      const res = await AdminApi.apiFetch('/accesos', { headers: AdminApi.authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      catalog = data.catalog || [];
      users = data.users || [];
      renderUserSelect();
      if (users.length) selectUser(users[0].id);
      else panel.innerHTML = '<p style="padding:20px;color:var(--text-muted)">No hay usuarios</p>';
    } catch (err) {
      panel.innerHTML = '<p style="padding:20px;color:var(--color-danger)">' + AdminApi.escapeHtml(err.message) + '</p>';
    }
  }

  function renderUserSelect() {
    select.innerHTML = users.map(function (u) {
      const estado = u.activo ? '' : ' (inactivo)';
      const protegido = !u.editable ? ' · protegido' : '';
      return '<option value="' + u.id + '">' + AdminApi.escapeHtml(u.nombre || u.username) +
        ' — @' + AdminApi.escapeHtml(u.username) + ' [' + u.rol + ']' + estado + protegido + '</option>';
    }).join('');
    select.onchange = function () { selectUser(parseInt(select.value, 10)); };
  }

  function selectUser(id) {
    userActivo = users.find(function (u) { return u.id === id; }) || null;
    if (!userActivo) {
      meta.textContent = '';
      panel.innerHTML = '';
      return;
    }
    select.value = String(userActivo.id);
    meta.textContent = 'Rol: ' + userActivo.rol + ' · Usuario: ' + userActivo.username +
      (userActivo.editable ? '' : ' · Los permisos de este usuario no se pueden modificar');
    btnGuardar.disabled = !userActivo.editable;
    renderPanel();
  }

  function renderPanel() {
    if (!userActivo) return;
    const activos = new Set(userActivo.items || []);
    const editable = userActivo.editable;
    const assignable = catalog.filter(function (c) { return c.clave !== 'accesos'; });

    panel.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">' +
      assignable.map(function (item) {
        const checked = activos.has(item.clave) ? ' checked' : '';
        const disabled = editable ? '' : ' disabled';
        return '<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border-color);border-radius:10px;cursor:' +
          (editable ? 'pointer' : 'not-allowed') + ';background:var(--bg-card);opacity:' + (editable ? '1' : '.75') + '">' +
          '<input type="checkbox" data-clave="' + item.clave + '"' + checked + disabled + ' style="width:16px;height:16px;accent-color:var(--color-primary)">' +
          '<span style="font-size:.85rem;font-weight:500">' + AdminApi.escapeHtml(item.nombre) + '</span>' +
        '</label>';
      }).join('') +
      '</div>' +
      (editable ? '' : '<p style="margin-top:14px;font-size:.8rem;color:var(--text-muted)">El Super Admin tiene acceso a todas las vistas.</p>');
  }

  async function guardar() {
    if (!userActivo || !userActivo.editable) return;
    const items = [];
    panel.querySelectorAll('input[data-clave]:checked').forEach(function (el) {
      items.push(el.dataset.clave);
    });
    btnGuardar.disabled = true;
    try {
      const res = await AdminApi.apiFetch('/accesos/usuario/' + userActivo.id, {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');
      userActivo.items = data.items || items;
      toast('Accesos guardados', 'success');
    } catch (err) {
      toast(err.message || 'Error al guardar', 'error');
    } finally {
      btnGuardar.disabled = !userActivo.editable;
    }
  }
})();
