(function () {
  AdminLayout.init({ page: 'tribu-users', title: '🫂 Usuarios Tribu' });

  const bodyEl = document.getElementById('tribu-body');
  const inpBusqueda = document.getElementById('inp-busqueda');
  const selPerPage = document.getElementById('sel-per-page');
  const pgWrap = document.getElementById('pg-wrap');
  const pgButtons = document.getElementById('pg-buttons');
  const pgTotal = document.getElementById('pg-total');
  const pswUsuario = document.getElementById('psw-usuario');
  const pswCargando = document.getElementById('psw-cargando');
  const pswValorWrap = document.getElementById('psw-valor-wrap');
  const pswValorEl = document.getElementById('psw-valor');
  const pswError = document.getElementById('psw-error');
  const btnTogglePsw = document.getElementById('btn-toggle-psw');
  const btnCopiarPsw = document.getElementById('btn-copiar-psw');

  let usuarios = [];
  let page = 1;
  let total = 0;
  let totalPages = 1;
  let perPage = 10;
  let debounceTimer = null;
  let pswValor = '';
  let pswVisible = false;

  AdminUtils.bindModalClose(document.getElementById('page-main'));

  inpBusqueda.addEventListener('input', onBusqueda);
  selPerPage.addEventListener('change', function () {
    perPage = parseInt(selPerPage.value, 10) || 10;
    cargar(1);
  });
  pgButtons.addEventListener('click', onPaginationClick);
  bodyEl.addEventListener('click', onTableClick);
  btnTogglePsw.addEventListener('click', togglePswVisible);
  btnCopiarPsw.addEventListener('click', copiarPsw);

  cargar(1);

  function suscritoBadge(suscrito) {
    return suscrito
      ? '<span class="badge" style="background:#d1fae5;color:#065f46">✅ Sí</span>'
      : '<span class="badge" style="background:#f3f4f6;color:#6b7280">No</span>';
  }

  function passwordCell(u) {
    if (!u.psw_temp) {
      return '<span class="badge" style="background:#d1fae5;color:#065f46">Cambiada</span>';
    }
    return '<button type="button" class="btn btn-outline btn-xs" data-action="ver-psw" data-id="' + u.id + '">🔑 Ver temporal</button>';
  }

  function render() {
    if (!usuarios.length) {
      bodyEl.innerHTML =
        '<div class="table-desktop"><table><thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Estado</th><th>Suscrito</th><th>Contraseña</th><th>Registro</th></tr></thead>' +
        '<tbody><tr><td colspan="7" class="table-empty"><div class="empty-icon">🫂</div><div class="empty-text">No hay usuarios de La Tribu</div></td></tr></tbody></table></div>' +
        '<div class="mobile-cards"><div style="text-align:center;padding:32px;color:#aaa">🫂 No hay usuarios</div></div>';
      renderPagination();
      return;
    }

    let rows = '';
    let cards = '';
    usuarios.forEach(function (u) {
      const nombre = AdminApi.escapeHtml(((u.nombre || '') + ' ' + (u.apellido || '')).trim());
      const email = AdminApi.escapeHtml(u.email || '—');
      const telefono = AdminApi.escapeHtml(u.telefono || '—');
      const estadoBadge = '<span class="badge" style="' + AdminUtils.badgeEstado(u.estado) + '">' + AdminApi.escapeHtml(u.estado) + '</span>';
      const suscrito = suscritoBadge(u.is_suscribed);
      const psw = passwordCell(u);
      const fecha = AdminUtils.fmtFechaShort(u.created_at);

      rows +=
        '<tr>' +
          '<td><strong>' + nombre + '</strong></td>' +
          '<td>' + email + '</td>' +
          '<td>' + telefono + '</td>' +
          '<td>' + estadoBadge + '</td>' +
          '<td>' + suscrito + '</td>' +
          '<td>' + psw + '</td>' +
          '<td style="font-size:.82rem;color:#888">' + AdminApi.escapeHtml(fecha) + '</td>' +
        '</tr>';

      const pswMobile = u.psw_temp
        ? '<button type="button" class="btn btn-outline btn-xs" style="margin-left:4px" data-action="ver-psw" data-id="' + u.id + '">🔑 Ver</button>'
        : '<span class="badge" style="background:#d1fae5;color:#065f46;margin-left:4px">Cambiada</span>';

      cards +=
        '<div class="mc-item">' +
          '<div class="mc-header">' +
            '<span class="mc-title">' + nombre + '</span>' +
            (u.is_suscribed
              ? '<span class="badge" style="background:#d1fae5;color:#065f46">✅ Suscrito</span>'
              : '<span class="badge" style="background:#f3f4f6;color:#6b7280">No suscrito</span>') +
          '</div>' +
          '<div class="mc-row">📧 ' + email + '</div>' +
          '<div class="mc-row">📱 ' + telefono + '</div>' +
          '<div class="mc-row">Estado: ' + AdminApi.escapeHtml(u.estado) + '</div>' +
          '<div class="mc-row">Contraseña: ' + pswMobile + '</div>' +
          '<div class="mc-row" style="font-size:.8rem;color:#888">' + AdminApi.escapeHtml(fecha) + '</div>' +
        '</div>';
    });

    bodyEl.innerHTML =
      '<div class="table-desktop"><table><thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Estado</th><th>Suscrito</th><th>Contraseña</th><th>Registro</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<div class="mobile-cards">' + cards + '</div>';

    renderPagination();
  }

  function renderPagination() {
    if (totalPages <= 1) {
      pgWrap.style.display = total > 0 ? 'block' : 'none';
      pgButtons.innerHTML = '';
      pgTotal.textContent = total > 0
        ? total + ' usuario' + (total !== 1 ? 's' : '') + ' en total'
        : '';
      return;
    }

    pgWrap.style.display = 'block';
    let html = '<button type="button" class="btn btn-secondary" data-page="prev"' + (page === 1 ? ' disabled' : '') + '>‹ Anterior</button>';

    AdminUtils.paginasVisibles(page, totalPages).forEach(function (p) {
      if (p === '...') {
        html += '<span style="padding:0 4px;color:#9ca3af">…</span>';
      } else {
        html += '<button type="button" class="btn ' + (p === page ? 'btn-primary' : 'btn-secondary') + '" data-page="' + p + '">' + p + '</button>';
      }
    });

    html += '<button type="button" class="btn btn-secondary" data-page="next"' + (page === totalPages ? ' disabled' : '') + '>Siguiente ›</button>';
    pgButtons.innerHTML = html;
    pgTotal.textContent = total + ' usuario' + (total !== 1 ? 's' : '') + ' en total';
  }

  async function cargar(p) {
    page = p;
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(perPage) });
      const q = inpBusqueda.value.trim();
      if (q) params.set('q', q);

      const res = await AdminApi.apiFetch('/tribu-users?' + params.toString(), { headers: AdminApi.authHeaders() });
      const data = await res.json();
      usuarios = data.data || [];
      total = data.total || 0;
      totalPages = data.totalPages || 1;
      render();
    } catch {
      toast('Error cargando usuarios de La Tribu', 'error');
    }
  }

  function onBusqueda() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { cargar(1); }, 350);
  }

  function onPaginationClick(e) {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    const val = btn.getAttribute('data-page');
    if (val === 'prev') cargar(page - 1);
    else if (val === 'next') cargar(page + 1);
    else cargar(parseInt(val, 10));
  }

  function onTableClick(e) {
    const btn = e.target.closest('[data-action="ver-psw"]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'), 10);
    const u = usuarios.find(function (x) { return x.id === id; });
    if (u) verPassword(u);
  }

  async function verPassword(u) {
    pswUsuario.textContent = (u.nombre || '') + ' ' + (u.apellido || '');
    pswValor = '';
    pswVisible = false;
    pswCargando.style.display = 'block';
    pswValorWrap.style.display = 'none';
    pswError.style.display = 'none';
    btnTogglePsw.textContent = '👁️';
    btnTogglePsw.title = 'Mostrar';
    AdminUtils.showModal('modal-psw');

    try {
      const res = await AdminApi.apiFetch('/tribu-users/' + u.id + '/password-temp', { headers: AdminApi.authHeaders() });
      const data = await res.json();
      pswValor = data.password || '';
    } catch {
      toast('Error al obtener contraseña', 'error');
    } finally {
      pswCargando.style.display = 'none';
      if (pswValor) {
        pswValorWrap.style.display = 'block';
        updatePswDisplay();
      } else {
        pswError.style.display = 'block';
      }
    }
  }

  function updatePswDisplay() {
    pswValorEl.textContent = pswVisible ? pswValor : '•'.repeat(pswValor.length);
  }

  function togglePswVisible() {
    if (!pswValor) return;
    pswVisible = !pswVisible;
    btnTogglePsw.textContent = pswVisible ? '🙈' : '👁️';
    btnTogglePsw.title = pswVisible ? 'Ocultar' : 'Mostrar';
    updatePswDisplay();
  }

  function copiarPsw() {
    if (!pswValor) return;
    navigator.clipboard.writeText(pswValor).then(function () {
      toast('Contraseña copiada', 'success');
    }).catch(function () {
      toast('No se pudo copiar', 'error');
    });
  }
})();
