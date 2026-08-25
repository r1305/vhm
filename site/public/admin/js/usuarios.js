(function () {
  AdminLayout.init({ page: 'usuarios', title: '👥 Administradores' });

  const bodyEl = document.getElementById('usuarios-body');
  const btnNuevo = document.getElementById('btn-nuevo');
  const btnGuardar = document.getElementById('btn-guardar');
  const modalTitle = document.getElementById('modal-usuario-title');
  const fUsername = document.getElementById('f-username');
  const fNombre = document.getElementById('f-nombre');
  const fEmail = document.getElementById('f-email');
  const fPassword = document.getElementById('f-password');
  const fRol = document.getElementById('f-rol');
  const fPasswordHint = document.getElementById('f-password-hint');
  const optSuperAdmin = document.getElementById('opt-super-admin');

  let usuarios = [];
  let editandoId = null;
  let guardando = false;

  if (AdminAuth.isSuperAdmin() && optSuperAdmin) {
    optSuperAdmin.style.display = '';
  }

  AdminUtils.bindModalClose(document.getElementById('page-main'));

  btnNuevo.addEventListener('click', mostrarModalNuevo);
  btnGuardar.addEventListener('click', guardar);
  bodyEl.addEventListener('click', onTableClick);

  cargarUsuarios();

  function canEdit(u) {
    if (u.es_protegido) return false;
    if (u.rol === 'SUPER_ADMIN' && !AdminAuth.isSuperAdmin()) return false;
    return true;
  }

  function rolBadgeStyle(rol) {
    return rol === 'SUPER_ADMIN'
      ? 'background:#ede9fe;color:#6d28d9'
      : 'background:#dbeafe;color:#1d4ed8';
  }

  function accionesHtml(u) {
    if (u.es_protegido) {
      return '<em style="font-size:.8rem;color:#aaa">Protegido</em>';
    }
    if (u.rol === 'SUPER_ADMIN' && !AdminAuth.isSuperAdmin()) {
      return '<em style="font-size:.8rem;color:#aaa">Sin permiso</em>';
    }
    return '<button type="button" class="btn btn-primary btn-xs" data-action="editar" data-id="' + u.id + '">Editar</button> ' +
      '<button type="button" class="btn btn-danger btn-xs" data-action="eliminar" data-id="' + u.id + '">Eliminar</button>';
  }

  function render() {
    if (!usuarios.length) {
      bodyEl.innerHTML =
        '<div class="table-desktop"><table><thead><tr><th>Usuario</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>' +
        '<tbody><tr><td colspan="6" class="table-empty"><div class="empty-icon">👥</div><div class="empty-text">No hay usuarios</div></td></tr></tbody></table></div>' +
        '<div class="mobile-cards"><div style="text-align:center;padding:32px;color:#aaa">👥 No hay usuarios</div></div>';
      return;
    }

    let rows = '';
    let cards = '';
    usuarios.forEach(function (u) {
      const estado = u.activo
        ? '<span class="badge badge-activo">✅ Activo</span>'
        : '<span class="badge badge-inactivo">❌ Inactivo</span>';
      const rolBadge = '<span class="badge" style="' + rolBadgeStyle(u.rol) + '">' + AdminApi.escapeHtml(u.rol) + '</span>';
      const acciones = accionesHtml(u);

      rows +=
        '<tr>' +
          '<td><strong style="color:#667eea">' + AdminApi.escapeHtml(u.username) + '</strong></td>' +
          '<td>' + AdminApi.escapeHtml(u.nombre) + '</td>' +
          '<td>' + AdminApi.escapeHtml(u.email) + '</td>' +
          '<td>' + rolBadge + '</td>' +
          '<td>' + estado + '</td>' +
          '<td>' + acciones + '</td>' +
        '</tr>';

      cards +=
        '<div class="mc-item">' +
          '<div class="mc-header">' +
            '<span class="mc-title">' + AdminApi.escapeHtml(u.username) + '</span>' +
            rolBadge +
          '</div>' +
          '<div class="mc-row">👤 ' + AdminApi.escapeHtml(u.nombre) + '</div>' +
          '<div class="mc-row">📧 ' + AdminApi.escapeHtml(u.email) + '</div>' +
          '<div class="mc-row">' + (u.activo ? '✅ Activo' : '❌ Inactivo') + '</div>' +
          '<div class="mc-actions">' + acciones + '</div>' +
        '</div>';
    });

    bodyEl.innerHTML =
      '<div class="table-desktop"><table><thead><tr><th>Usuario</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<div class="mobile-cards">' + cards + '</div>';
  }

  async function cargarUsuarios() {
    try {
      const res = await AdminApi.apiFetch('/usuarios', { headers: AdminApi.authHeaders() });
      usuarios = await res.json();
      render();
    } catch {
      toast('Error cargando usuarios', 'error');
    }
  }

  function mostrarModalNuevo() {
    editandoId = null;
    modalTitle.textContent = '👤 Nuevo Usuario';
    fUsername.disabled = false;
    fUsername.value = '';
    fNombre.value = '';
    fEmail.value = '';
    fPassword.value = '';
    fRol.value = 'ADMIN';
    fPasswordHint.textContent = '(obligatoria para nuevos usuarios)';
    AdminUtils.showModal('modal-usuario');
  }

  function editar(id) {
    const u = usuarios.find(function (x) { return x.id === id; });
    if (!u || !canEdit(u)) return;

    editandoId = u.id;
    modalTitle.textContent = '✏️ Editar Usuario';
    fUsername.disabled = true;
    fUsername.value = u.username || '';
    fNombre.value = u.nombre || '';
    fEmail.value = u.email || '';
    fPassword.value = '';
    fRol.value = u.rol || 'ADMIN';
    fPasswordHint.textContent = '(dejar vacío para no cambiar)';
    AdminUtils.showModal('modal-usuario');
  }

  async function guardar() {
    if (guardando) return;

    const username = fUsername.value.trim();
    const nombre = fNombre.value.trim();
    const email = fEmail.value.trim();
    const password = fPassword.value;
    const rol = fRol.value;

    if (!editandoId && !password) {
      toast('La contraseña es obligatoria para nuevos usuarios', 'error');
      return;
    }

    const body = { username: username, nombre: nombre, email: email, rol: rol };
    if (password) body.password = password;

    guardando = true;
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      const url = editandoId ? '/usuarios/' + editandoId : '/usuarios';
      const res = await AdminApi.apiFetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        AdminUtils.hideModal('modal-usuario');
        await cargarUsuarios();
        toast('Usuario guardado', 'success');
      } else {
        toast(data.error || 'Error al guardar', 'error');
      }
    } catch {
      toast('Error de conexión', 'error');
    } finally {
      guardando = false;
      btnGuardar.disabled = false;
      btnGuardar.textContent = '💾 Guardar';
    }
  }

  async function eliminar(id) {
    const u = usuarios.find(function (x) { return x.id === id; });
    if (!u || !canEdit(u)) return;
    if (!confirm('¿Eliminar este usuario?')) return;

    try {
      const res = await AdminApi.apiFetch('/usuarios/' + id, {
        method: 'DELETE',
        headers: AdminApi.authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        await cargarUsuarios();
        toast('Usuario eliminado', 'success');
      } else {
        toast(data.error || 'Error al eliminar', 'error');
      }
    } catch {
      toast('Error de conexión', 'error');
    }
  }

  function onTableClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'), 10);
    const action = btn.getAttribute('data-action');
    if (action === 'editar') editar(id);
    else if (action === 'eliminar') eliminar(id);
  }
})();
