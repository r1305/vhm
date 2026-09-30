(function () {
  AdminLayout.init({ page: 'posts', title: '💜 Comunidad' }).then(function (ok) {
    if (!ok) return;

    var page = 1;
    var totalPages = 1;
    var total = 0;
    var ocupado = false;

    var tbody = document.getElementById('posts-body');
    var mobileEl = document.getElementById('posts-mobile');
    var paginacion = document.getElementById('posts-paginacion');
    var inputBuscar = document.getElementById('input-buscar');
    var selectEstado = document.getElementById('select-estado');
    var btnRecargar = document.getElementById('btn-recargar');

    var temporizador = null;
    inputBuscar.addEventListener('input', function () {
      clearTimeout(temporizador);
      temporizador = setTimeout(function () { page = 1; cargar(); }, 300);
    });
    selectEstado.addEventListener('change', function () { page = 1; cargar(); });
    btnRecargar.addEventListener('click', function () { cargar(); });

    cargar();

    async function cargar() {
      if (ocupado) return;
      ocupado = true;
      try {
        var qs = new URLSearchParams({
          page: String(page), limit: '20',
          q: inputBuscar.value.trim(),
          activo: selectEstado.value,
        });
        var res = await AdminApi.apiFetch('/posts/admin?' + qs.toString(), {
          headers: AdminApi.authHeaders(),
        });
        if (res.status === 401 || res.status === 403) {
          toast('Tu sesión expiró o no tienes acceso', 'error');
          return;
        }
        var data = await res.json();
        total = data.total || 0;
        totalPages = data.totalPages || 1;
        renderTabla(data.data || []);
        renderPaginacion();
      } catch (e) {
        toast('Error cargando las publicaciones', 'error');
      } finally {
        ocupado = false;
      }
    }

    function renderPaginacion() {
      if (totalPages <= 1) { paginacion.innerHTML = ''; return; }
      paginacion.innerHTML =
        '<button type="button" class="btn btn-outline btn-sm" data-pag="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>Anterior</button>' +
        '<span style="font-size:.85rem;color:#888">Página ' + page + ' de ' + totalPages + ' · ' + total + ' publicaciones</span>' +
        '<button type="button" class="btn btn-outline btn-sm" data-pag="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>Siguiente</button>';
      paginacion.querySelectorAll('[data-pag]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          page = parseInt(btn.getAttribute('data-pag'), 10);
          if (page < 1 || page > totalPages) return;
          cargar();
        });
      });
    }

    // "(Foto)" es el marcador que guarda el backend cuando la publicación no
    // lleva texto; no se ensucia la tabla con él.
    function textoLegible(p) {
      if (!p.contenido || p.contenido === '(Foto)') return p.foto_url ? '📷 Solo foto' : '—';
      return p.contenido;
    }

    function fechaLegible(iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('es-PE', {
        timeZone: 'America/Lima', day: '2-digit', month: '2-digit',
        year: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    }

    function renderTabla(posts) {
      if (!posts.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-empty">' +
          '<div class="empty-icon">💜</div><div class="empty-text">No hay publicaciones que coincidan</div></td></tr>';
        mobileEl.innerHTML = '<div style="text-align:center;padding:32px;color:#aaa">💜 No hay publicaciones</div>';
        return;
      }

      tbody.innerHTML = posts.map(function (p) {
        var autor = p.autor || {};
        var nombre = autor.nombre_completo ||
          ((autor.nombre || '') + ' ' + (autor.apellido || '')).trim() || 'Miembro';
        var foto = p.foto_url
          ? '<img src="' + AdminApi.escapeHtml(p.foto_url) + '" class="avatar-sm" alt="">'
          : '—';
        var badge = p.activo
          ? '<span class="badge badge-activo">✅ Visible</span>'
          : '<span class="badge badge-inactivo">🚫 Oculta</span>';
        var texto = textoLegible(p);
        var truncado = texto.length > 90 ? texto.slice(0, 90) + '…' : texto;
        return '<tr>' +
          '<td><strong style="color:#A84F3E">' + AdminApi.escapeHtml(nombre) + '</strong></td>' +
          '<td style="max-width:320px">' + AdminApi.escapeHtml(truncado) +
            (p.mine_edit ? ' <span style="font-size:.75rem;color:#999">(editado)</span>' : '') + '</td>' +
          '<td>' + foto + '</td>' +
          '<td>' + (p.likes || 0) + '</td>' +
          '<td style="font-size:.8rem;color:#888">' + AdminApi.escapeHtml(fechaLegible(p.created_at)) + '</td>' +
          '<td>' + badge + '</td>' +
          '<td>' +
            '<button type="button" class="btn btn-outline btn-xs" data-toggle="' + p.id + '" data-activo="' + (p.activo ? 1 : 0) + '">' +
              (p.activo ? 'Ocultar' : 'Mostrar') + '</button> ' +
            '<button type="button" class="btn btn-danger btn-xs" data-delete="' + p.id + '">Eliminar</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      mobileEl.innerHTML = posts.map(function (p) {
        var autor = p.autor || {};
        var nombre = autor.nombre_completo ||
          ((autor.nombre || '') + ' ' + (autor.apellido || '')).trim() || 'Miembro';
        return '<div class="mc-item">' +
          '<div class="mc-header">' +
            '<span class="mc-title">' + AdminApi.escapeHtml(nombre) + '</span>' +
            (p.activo ? '<span class="badge badge-activo">Visible</span>'
                      : '<span class="badge badge-inactivo">Oculta</span>') +
          '</div>' +
          '<div class="mc-row">💬 ' + AdminApi.escapeHtml(textoLegible(p)) + '</div>' +
          '<div class="mc-row">🤍 ' + (p.likes || 0) + ' apoyos · ' + AdminApi.escapeHtml(fechaLegible(p.created_at)) + '</div>' +
          '<div class="mc-actions">' +
            '<button type="button" class="btn btn-outline btn-xs" data-toggle="' + p.id + '" data-activo="' + (p.activo ? 1 : 0) + '">' +
              (p.activo ? 'Ocultar' : 'Mostrar') + '</button> ' +
            '<button type="button" class="btn btn-danger btn-xs" data-delete="' + p.id + '">Eliminar</button>' +
          '</div>' +
        '</div>';
      }).join('');

      tbody.querySelectorAll('[data-toggle]').forEach(enlazarToggle);
      mobileEl.querySelectorAll('[data-toggle]').forEach(enlazarToggle);
      document.querySelectorAll('#posts-body [data-delete], #posts-mobile [data-delete]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          eliminar(parseInt(btn.getAttribute('data-delete'), 10));
        });
      });
    }

    function enlazarToggle(btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-toggle');
        var activo = btn.getAttribute('data-activo') === '1';
        moderar(id, !activo, btn);
      });
    }

    async function moderar(id, activo, btn) {
      btn.disabled = true;
      try {
        var res = await AdminApi.apiFetch('/posts/' + id + '/moderar', {
          method: 'PUT',
          headers: AdminApi.authHeaders(),
          body: JSON.stringify({ activo: activo }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        toast(activo ? 'Publicación visible' : 'Publicación oculta', 'success');
        await cargar();
      } catch (e) {
        btn.disabled = false;
        toast('No se pudo cambiar el estado', 'error');
      }
    }

    async function eliminar(id) {
      if (!confirm('Esta acción no se puede deshacer. ¿Eliminar la publicación y su foto?')) return;
      try {
        var res = await AdminApi.apiFetch('/posts/admin/' + id, {
          method: 'DELETE',
          headers: AdminApi.authHeaders(),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        toast('Publicación eliminada', 'success');
        await cargar();
      } catch (e) {
        toast('No se pudo eliminar la publicación', 'error');
      }
    }
  });
})();