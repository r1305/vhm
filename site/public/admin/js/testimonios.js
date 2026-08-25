(function () {
  AdminLayout.init({ page: 'testimonios', title: '⭐ Testimonios' });

  var testimonios = [];
  var seccionVisible = false;
  var editandoId = null;
  var fotoFile = null;
  var eliminarFoto = false;
  var guardando = false;

  var btnToggle = document.getElementById('btn-toggle-seccion');
  var btnNuevo = document.getElementById('btn-nuevo');
  var tbody = document.getElementById('testimonios-body');
  var mobileEl = document.getElementById('testimonios-mobile');
  var modalTitle = document.getElementById('modal-testimonio-title');
  var inputAutor = document.getElementById('input-autor');
  var inputTexto = document.getElementById('input-texto');
  var inputFoto = document.getElementById('input-foto');
  var selectActivo = document.getElementById('select-activo');
  var fotoPreview = document.getElementById('foto-preview');
  var fotoPreviewImg = document.getElementById('foto-preview-img');
  var btnQuitarFoto = document.getElementById('btn-quitar-foto');
  var btnGuardar = document.getElementById('btn-guardar-testimonio');

  AdminUtils.bindModalClose();

  btnToggle.addEventListener('click', toggleSeccion);
  btnNuevo.addEventListener('click', function () { mostrarModal(); });
  inputFoto.addEventListener('change', onFotoChange);
  btnQuitarFoto.addEventListener('click', quitarFoto);
  btnGuardar.addEventListener('click', guardar);

  cargarTestimonios();

  async function cargarTestimonios() {
    try {
      var results = await Promise.all([
        AdminApi.apiFetch('/testimonios/admin', { headers: AdminApi.authHeaders() }),
        AdminApi.apiFetch('/testimonios/config', { headers: AdminApi.authHeaders() }),
      ]);
      testimonios = await results[0].json();
      var cfg = await results[1].json();
      seccionVisible = !!cfg.seccion_activa;
      actualizarToggleBtn();
      renderTabla();
    } catch (e) {
      toast('Error cargando testimonios', 'error');
    }
  }

  function actualizarToggleBtn() {
    if (seccionVisible) {
      btnToggle.className = 'btn btn-success btn-sm';
      btnToggle.textContent = '👁️ Sección visible';
    } else {
      btnToggle.className = 'btn btn-outline btn-sm';
      btnToggle.textContent = '🚫 Sección oculta';
    }
  }

  function renderTabla() {
    if (!testimonios.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="table-empty">' +
          '<div class="empty-icon">⭐</div>' +
          '<div class="empty-text">No hay testimonios</div>' +
        '</td></tr>';
      mobileEl.innerHTML = '<div style="text-align:center;padding:32px;color:#aaa">⭐ No hay testimonios</div>';
      return;
    }

    tbody.innerHTML = testimonios.map(function (t) {
      var foto = t.foto_url
        ? '<img src="' + AdminApi.escapeHtml(t.foto_url) + '" class="avatar-sm" alt="">'
        : '—';
      var badge = t.activo
        ? '<span class="badge badge-activo">✅ Activo</span>'
        : '<span class="badge badge-inactivo">❌ Inactivo</span>';
      return '<tr>' +
        '<td>' + foto + '</td>' +
        '<td><strong style="color:#667eea">' + AdminApi.escapeHtml(t.autor || '') + '</strong></td>' +
        '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + AdminApi.escapeHtml(t.texto || '') + '</td>' +
        '<td style="font-size:.8rem;color:#888">' + AdminApi.escapeHtml(t.creado_por_nombre || '—') + '</td>' +
        '<td>' + badge + '</td>' +
        '<td>' +
          '<button type="button" class="btn btn-primary btn-xs" data-edit="' + t.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-delete="' + t.id + '">Eliminar</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    mobileEl.innerHTML = testimonios.map(function (t) {
      var badge = t.activo
        ? '<span class="badge badge-activo">Activo</span>'
        : '<span class="badge badge-inactivo">Inactivo</span>';
      return '<div class="mc-item">' +
        '<div class="mc-header">' +
          '<span class="mc-title">' + AdminApi.escapeHtml(t.autor || '') + '</span>' +
          badge +
        '</div>' +
        '<div class="mc-row">💬 ' + AdminApi.escapeHtml(t.texto || '') + '</div>' +
        '<div class="mc-actions">' +
          '<button type="button" class="btn btn-primary btn-xs" data-edit="' + t.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-delete="' + t.id + '">Eliminar</button>' +
        '</div>' +
      '</div>';
    }).join('');

    document.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-edit'), 10);
        var t = testimonios.find(function (x) { return x.id === id; });
        if (t) editar(t);
      });
    });
    document.querySelectorAll('[data-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        eliminar(parseInt(btn.getAttribute('data-delete'), 10));
      });
    });
  }

  async function toggleSeccion() {
    try {
      var res = await AdminApi.apiFetch('/testimonios/config', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({ seccion_activa: !seccionVisible }),
      });
      if (res.ok) {
        await cargarTestimonios();
        toast(seccionVisible ? 'Sección habilitada' : 'Sección deshabilitada', 'success');
      } else {
        toast('Error al cambiar visibilidad', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    }
  }

  function mostrarModal() {
    editandoId = null;
    modalTitle.textContent = '⭐ Nuevo Testimonio';
    inputAutor.value = '';
    inputTexto.value = '';
    selectActivo.value = '1';
    fotoFile = null;
    eliminarFoto = false;
    inputFoto.value = '';
    ocultarPreview();
    AdminUtils.showModal('modal-testimonio');
  }

  function editar(t) {
    editandoId = t.id;
    modalTitle.textContent = '✏️ Editar Testimonio';
    inputAutor.value = t.autor || '';
    inputTexto.value = t.texto || '';
    selectActivo.value = t.activo ? '1' : '0';
    fotoFile = null;
    eliminarFoto = false;
    inputFoto.value = '';
    if (t.foto_url) {
      fotoPreviewImg.src = t.foto_url;
      fotoPreview.style.display = 'flex';
    } else {
      ocultarPreview();
    }
    AdminUtils.showModal('modal-testimonio');
  }

  function ocultarPreview() {
    fotoPreviewImg.src = '';
    fotoPreview.style.display = 'none';
  }

  function onFotoChange(e) {
    var file = e.target.files[0];
    if (!file) return;
    fotoFile = file;
    eliminarFoto = false;
    var reader = new FileReader();
    reader.onload = function (ev) {
      fotoPreviewImg.src = ev.target.result;
      fotoPreview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }

  function quitarFoto() {
    fotoFile = null;
    eliminarFoto = true;
    inputFoto.value = '';
    ocultarPreview();
  }

  async function guardar() {
    if (guardando) return;
    var fd = new FormData();
    fd.append('autor', inputAutor.value);
    fd.append('texto', inputTexto.value);
    fd.append('activo', selectActivo.value === '1' ? 'true' : 'false');
    if (fotoFile) fd.append('foto', fotoFile);
    if (eliminarFoto) fd.append('eliminar_foto', 'true');

    guardando = true;
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      var url = editandoId ? '/testimonios/' + editandoId : '/testimonios';
      var res = await AdminApi.apiFetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: AdminApi.formHeaders(),
        body: fd,
      });
      var data = await res.json();
      if (res.ok) {
        AdminUtils.hideModal('modal-testimonio');
        await cargarTestimonios();
        toast('Testimonio guardado', 'success');
      } else {
        toast(data.error || 'Error al guardar', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    } finally {
      guardando = false;
      btnGuardar.disabled = false;
      btnGuardar.textContent = '💾 Guardar';
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este testimonio?')) return;
    try {
      var res = await AdminApi.apiFetch('/testimonios/' + id, {
        method: 'DELETE',
        headers: AdminApi.authHeaders(),
      });
      var data = await res.json();
      if (res.ok) {
        await cargarTestimonios();
        toast('Testimonio eliminado', 'success');
      } else {
        toast(data.error || 'Error al eliminar', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    }
  }
})();
