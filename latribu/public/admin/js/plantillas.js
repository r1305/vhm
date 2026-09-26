(function () {
  AdminLayout.init({ page: 'plantillas', title: '📝 Plantillas' }).then(function (ok) {
    if (!ok) return;

    var eventos = [];
    var mensajesCache = {};
    var openEventoId = null;
    var editEventoId = null;
    var editMensajeId = null;
    var mensajeEventoId = null;
    var waEditor = null;
    var guardando = false;

    // Foto en modal de mensaje
    var fotoFile = null;       // File seleccionado (nuevo)
    var fotoQuitada = false;   // Si se marcó quitar la foto existente

    // Modal de foto independiente
    var fotoModalMsgId = null;
    var fotoModalFile = null;

    var listEl = document.getElementById('plantillas-list');
    var btnNuevoEvento = document.getElementById('btn-nuevo-evento');
    var modalEventoTitle = document.getElementById('modal-evento-title');
    var evNombre = document.getElementById('ev-nombre');
    var evFecha = document.getElementById('ev-fecha');
    var btnGuardarEvento = document.getElementById('btn-guardar-evento');
    var modalMensajeTitle = document.getElementById('modal-mensaje-title');
    var msgTitulo = document.getElementById('msg-titulo');
    var btnGuardarMensaje = document.getElementById('btn-guardar-mensaje');

    // Foto en modal mensaje
    var msgFotoInput = document.getElementById('msg-foto-input');
    var msgFotoPreview = document.getElementById('msg-foto-preview');
    var msgFotoImg = document.getElementById('msg-foto-img');
    var btnQuitarFoto = document.getElementById('btn-quitar-foto');
    var btnSeleccionarFoto = document.getElementById('btn-seleccionar-foto');

    // Modal foto independiente
    var fotoModalInput = document.getElementById('foto-modal-input');
    var fotoModalPreview = document.getElementById('foto-modal-preview');
    var btnFotoModalSeleccionar = document.getElementById('btn-foto-modal-seleccionar');
    var btnFotoModalEliminar = document.getElementById('btn-foto-modal-eliminar');
    var btnFotoModalGuardar = document.getElementById('btn-foto-modal-guardar');

    AdminUtils.bindModalClose();

    waEditor = WaEditor.create(document.getElementById('wa-editor-root'), {
      placeholder: 'Escribe el mensaje con formato WhatsApp...',
    });

    btnNuevoEvento.addEventListener('click', function () { abrirModalEvento(); });
    btnGuardarEvento.addEventListener('click', guardarEvento);
    btnGuardarMensaje.addEventListener('click', guardarMensaje);

    // Foto en modal mensaje
    btnSeleccionarFoto.addEventListener('click', function () { msgFotoInput.click(); });
    msgFotoInput.addEventListener('change', function () {
      var file = msgFotoInput.files[0];
      if (!file) return;
      fotoFile = file;
      fotoQuitada = false;
      var url = URL.createObjectURL(file);
      msgFotoImg.src = url;
      msgFotoPreview.style.display = '';
    });
    btnQuitarFoto.addEventListener('click', function () {
      fotoFile = null;
      fotoQuitada = true;
      msgFotoImg.src = '';
      msgFotoPreview.style.display = 'none';
      msgFotoInput.value = '';
    });

    // Modal foto independiente
    btnFotoModalSeleccionar.addEventListener('click', function () { fotoModalInput.click(); });
    fotoModalInput.addEventListener('change', function () {
      var file = fotoModalInput.files[0];
      if (!file) return;
      fotoModalFile = file;
      var url = URL.createObjectURL(file);
      fotoModalPreview.innerHTML = '<img src="' + url + '" alt="preview" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border)">';
      btnFotoModalGuardar.style.display = '';
    });
    btnFotoModalEliminar.addEventListener('click', async function () {
      if (!fotoModalMsgId) return;
      if (!confirm('¿Eliminar la foto de este mensaje?')) return;
      try {
        var res = await AdminApi.apiFetch('/plantillas/mensajes/' + fotoModalMsgId + '/foto', { method: 'DELETE' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        toast('Foto eliminada', 'success');
        actualizarFotoEnCache(fotoModalMsgId, null);
        AdminUtils.hideModal('modal-foto');
      } catch (e) { toast(e.message || 'Error al eliminar foto', 'error'); }
    });
    btnFotoModalGuardar.addEventListener('click', async function () {
      if (!fotoModalMsgId || !fotoModalFile) return;
      try {
        btnFotoModalGuardar.disabled = true;
        var fd = new FormData();
        fd.append('foto', fotoModalFile);
        var res = await AdminApi.apiFetchForm('/plantillas/mensajes/' + fotoModalMsgId + '/foto', { method: 'POST', body: fd });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        toast('Foto guardada', 'success');
        actualizarFotoEnCache(fotoModalMsgId, data.foto_url);
        AdminUtils.hideModal('modal-foto');
      } catch (e) { toast(e.message || 'Error al subir foto', 'error'); }
      finally { btnFotoModalGuardar.disabled = false; }
    });

    setupListDelegation();
    cargarEventos();

    // ── Helpers ──

    function actualizarFotoEnCache(msgId, fotoUrl) {
      Object.keys(mensajesCache).forEach(function (evId) {
        var msgs = mensajesCache[evId];
        var m = msgs && msgs.find(function (x) { return x.id === msgId; });
        if (m) {
          m.foto_url = fotoUrl;
          var detail = document.getElementById('detail-' + evId);
          if (detail) detail.innerHTML = renderMensajesHtml(parseInt(evId, 10));
        }
      });
    }

    async function cargarEventos() {
      try {
        var res = await AdminApi.apiFetch('/plantillas/eventos');
        eventos = await res.json();
        renderEventos();
      } catch (e) { toast('Error cargando plantillas', 'error'); }
    }

    function fmtFecha(val) {
      if (!val) return '—';
      var s = String(val).substring(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        var p = s.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
      }
      return AdminUtils.fmtFechaShort(val);
    }

    function toInputDate(val) {
      if (!val) return '';
      var s = String(val).substring(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    }

    function renderEventos() {
      if (!eventos.length) {
        listEl.innerHTML =
          '<div class="table-empty" style="padding:48px 20px;text-align:center">' +
            '<div class="empty-icon">📝</div>' +
            '<div class="empty-text">No hay eventos de plantilla</div>' +
            '<p style="color:var(--text-muted);font-size:.85rem;margin-top:8px">Crea un evento para agregar mensajes con formato WhatsApp</p>' +
          '</div>';
        return;
      }
      listEl.innerHTML = eventos.map(function (ev) {
        var open = openEventoId === ev.id;
        return '<div class="plantilla-evento' + (open ? ' open' : '') + '" data-evento="' + ev.id + '">' +
          '<div class="plantilla-evento-summary" data-toggle="' + ev.id + '">' +
            '<button type="button" class="plantilla-toggle" aria-label="Expandir">▶</button>' +
            '<div class="plantilla-evento-info">' +
              '<div class="plantilla-evento-name">' + AdminApi.escapeHtml(ev.nombre) + '</div>' +
              '<div class="plantilla-evento-meta">📅 ' + fmtFecha(ev.fecha) +
                ' · ' + (ev.total_mensajes || 0) + ' mensaje(s)</div>' +
            '</div>' +
            '<div class="plantilla-evento-actions">' +
              '<button type="button" class="btn btn-primary btn-xs" data-add-msg="' + ev.id + '">+ Mensaje</button>' +
              '<button type="button" class="btn btn-outline btn-xs" data-edit-ev="' + ev.id + '">Editar</button>' +
              '<button type="button" class="btn btn-danger btn-xs" data-del-ev="' + ev.id + '">Eliminar</button>' +
            '</div>' +
          '</div>' +
          '<div class="plantilla-evento-detail" id="detail-' + ev.id + '">' +
            (open ? renderMensajesHtml(ev.id) : '<div class="loading-inline">Cargando mensajes...</div>') +
          '</div>' +
        '</div>';
      }).join('');
    }

    function setupListDelegation() {
      listEl.addEventListener('click', function (e) {
        var summary = e.target.closest('.plantilla-evento-summary[data-toggle]');
        if (summary) {
          if (e.target.closest('button:not(.plantilla-toggle)')) return;
          toggleEvento(parseInt(summary.getAttribute('data-toggle'), 10));
          return;
        }

        var btn = e.target.closest('[data-add-msg]');
        if (btn) { e.stopPropagation(); abrirModalMensaje(parseInt(btn.getAttribute('data-add-msg'), 10)); return; }

        btn = e.target.closest('[data-edit-ev]');
        if (btn) {
          e.stopPropagation();
          var evId = parseInt(btn.getAttribute('data-edit-ev'), 10);
          var ev = eventos.find(function (x) { return x.id === evId; });
          if (ev) abrirModalEvento(ev);
          return;
        }

        btn = e.target.closest('[data-del-ev]');
        if (btn) { e.stopPropagation(); eliminarEvento(parseInt(btn.getAttribute('data-del-ev'), 10)); return; }

        btn = e.target.closest('[data-edit-msg]');
        if (btn) {
          e.stopPropagation();
          var msgId = parseInt(btn.getAttribute('data-edit-msg'), 10);
          var eventoId = parseInt(btn.getAttribute('data-ev'), 10);
          var m = (mensajesCache[eventoId] || []).find(function (x) { return x.id === msgId; });
          if (m) abrirModalMensaje(eventoId, m);
          return;
        }

        btn = e.target.closest('[data-del-msg]');
        if (btn) {
          e.stopPropagation();
          eliminarMensaje(parseInt(btn.getAttribute('data-del-msg'), 10), parseInt(btn.getAttribute('data-ev'), 10));
          return;
        }

        btn = e.target.closest('[data-copy-msg]');
        if (btn) {
          e.stopPropagation();
          var copyId = parseInt(btn.getAttribute('data-copy-msg'), 10);
          var m = (mensajesCache[openEventoId] || []).find(function (x) { return x.id === copyId; });
          if (m) copiarMensaje(m.cuerpo);
          return;
        }

        btn = e.target.closest('[data-foto-msg]');
        if (btn) {
          e.stopPropagation();
          var fmId = parseInt(btn.getAttribute('data-foto-msg'), 10);
          var fmEvId = parseInt(btn.getAttribute('data-ev'), 10);
          var fm = (mensajesCache[fmEvId] || []).find(function (x) { return x.id === fmId; });
          if (fm) abrirModalFoto(fm);
          return;
        }

        btn = e.target.closest('[data-dl-foto]');
        if (btn) {
          e.stopPropagation();
          descargarFoto(btn.getAttribute('data-dl-foto'), btn.getAttribute('data-nombre'));
        }
      });
    }

    function renderMensajesHtml(eventoId) {
      var msgs = mensajesCache[eventoId];
      if (!msgs) return '<div class="loading-inline">Cargando mensajes...</div>';
      if (!msgs.length) {
        return '<div class="plantilla-mensajes-header">' +
            '<h4>Mensajes</h4>' +
            '<button type="button" class="btn btn-primary btn-xs" data-add-msg="' + eventoId + '">+ Agregar mensaje</button>' +
          '</div>' +
          '<p style="color:var(--text-muted);font-size:.85rem">Sin mensajes. Agrega el primero.</p>';
      }
      return '<div class="plantilla-mensajes-header">' +
          '<h4>' + msgs.length + ' mensaje(s)</h4>' +
          '<button type="button" class="btn btn-primary btn-xs" data-add-msg="' + eventoId + '">+ Agregar mensaje</button>' +
        '</div>' +
        msgs.map(function (m) {
          var fotoBtn = m.foto_url
            ? '<button type="button" class="btn btn-outline btn-xs" data-foto-msg="' + m.id + '" data-ev="' + eventoId + '" title="Ver/cambiar foto" style="color:#1a73e8;border-color:#1a73e8">🖼️ Foto</button>' +
              '<a class="btn btn-outline btn-xs" data-dl-foto="' + AdminApi.escapeHtml(m.foto_url) + '" data-nombre="' + AdminApi.escapeHtml(m.titulo) + '" href="' + AdminApi.escapeHtml(m.foto_url) + '" download title="Descargar foto" style="color:#1a73e8;border-color:#1a73e8">⬇️</a>'
            : '<button type="button" class="btn btn-outline btn-xs" data-foto-msg="' + m.id + '" data-ev="' + eventoId + '" title="Subir foto">📷 Foto</button>';

          return '<div class="plantilla-msg-card">' +
            '<div class="plantilla-msg-title">' + AdminApi.escapeHtml(m.titulo) + '</div>' +
            (m.foto_url ? '<div style="margin:6px 0"><img src="' + AdminApi.escapeHtml(m.foto_url) + '" alt="foto" style="max-width:100%;max-height:120px;border-radius:6px;border:1px solid var(--border)"></div>' : '') +
            '<div class="plantilla-msg-body">' + WaEditor.waToHtml(m.cuerpo) + '</div>' +
            '<div class="plantilla-msg-actions">' +
              '<button type="button" class="btn btn-outline btn-xs" data-copy-msg="' + m.id + '">📋 Copiar</button>' +
              fotoBtn +
              '<button type="button" class="btn btn-primary btn-xs" data-edit-msg="' + m.id + '" data-ev="' + eventoId + '">Editar</button>' +
              '<button type="button" class="btn btn-danger btn-xs" data-del-msg="' + m.id + '" data-ev="' + eventoId + '">Eliminar</button>' +
            '</div>' +
          '</div>';
        }).join('');
    }

    async function toggleEvento(id) {
      if (openEventoId === id) { openEventoId = null; renderEventos(); return; }
      openEventoId = id;
      renderEventos();
      if (!mensajesCache[id]) await cargarMensajes(id);
      else {
        var detail = document.getElementById('detail-' + id);
        if (detail) detail.innerHTML = renderMensajesHtml(id);
      }
    }

    async function cargarMensajes(eventoId) {
      try {
        var res = await AdminApi.apiFetch('/plantillas/eventos/' + eventoId + '/mensajes');
        mensajesCache[eventoId] = await res.json();
        var detail = document.getElementById('detail-' + eventoId);
        if (detail) detail.innerHTML = renderMensajesHtml(eventoId);
      } catch (e) { toast('Error cargando mensajes', 'error'); }
    }

    function abrirModalEvento(ev) {
      editEventoId = ev ? ev.id : null;
      modalEventoTitle.textContent = ev ? '📅 Editar evento' : '📅 Nuevo evento';
      evNombre.value = ev ? ev.nombre : '';
      evFecha.value = ev ? toInputDate(ev.fecha) : '';
      AdminUtils.showModal('modal-evento');
      evNombre.focus();
    }

    async function guardarEvento() {
      if (guardando) return;
      var nombre = evNombre.value.trim();
      var fecha = evFecha.value;
      if (!nombre) { toast('Ingresa el nombre del evento', 'error'); return; }
      if (!fecha) { toast('Selecciona la fecha', 'error'); return; }
      guardando = true; btnGuardarEvento.disabled = true;
      try {
        var url = editEventoId ? '/plantillas/eventos/' + editEventoId : '/plantillas/eventos';
        var method = editEventoId ? 'PUT' : 'POST';
        var res = await AdminApi.apiFetch(url, { method: method, body: JSON.stringify({ nombre: nombre, fecha: fecha }) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        toast(editEventoId ? 'Evento actualizado' : 'Evento creado', 'success');
        AdminUtils.hideModal('modal-evento');
        await cargarEventos();
        if (openEventoId) {
          var detail = document.getElementById('detail-' + openEventoId);
          if (detail && mensajesCache[openEventoId]) detail.innerHTML = renderMensajesHtml(openEventoId);
        }
      } catch (e) { toast(e.message || 'Error al guardar evento', 'error'); }
      finally { guardando = false; btnGuardarEvento.disabled = false; }
    }

    async function eliminarEvento(id) {
      var ev = eventos.find(function (x) { return x.id === id; });
      if (!ev) return;
      if (!confirm('¿Eliminar el evento "' + ev.nombre + '" y todos sus mensajes?')) return;
      try {
        var res = await AdminApi.apiFetch('/plantillas/eventos/' + id, { method: 'DELETE' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        delete mensajesCache[id];
        if (openEventoId === id) openEventoId = null;
        toast('Evento eliminado', 'success');
        await cargarEventos();
      } catch (e) { toast(e.message || 'Error al eliminar', 'error'); }
    }

    function abrirModalMensaje(eventoId, msg) {
      mensajeEventoId = eventoId;
      editMensajeId = msg ? msg.id : null;
      modalMensajeTitle.textContent = msg ? '💬 Editar mensaje' : '💬 Nuevo mensaje';
      msgTitulo.value = msg ? msg.titulo : '';
      waEditor.setValue(msg ? msg.cuerpo : '');
      // Reset foto
      fotoFile = null;
      fotoQuitada = false;
      msgFotoInput.value = '';
      if (msg && msg.foto_url) {
        msgFotoImg.src = msg.foto_url;
        msgFotoPreview.style.display = '';
      } else {
        msgFotoImg.src = '';
        msgFotoPreview.style.display = 'none';
      }
      AdminUtils.showModal('modal-mensaje');
      msgTitulo.focus();
    }

    async function guardarMensaje() {
      if (guardando) return;
      var titulo = msgTitulo.value.trim();
      var cuerpo = waEditor.getValue().trim();
      if (!titulo) { toast('Ingresa el título del mensaje', 'error'); return; }
      if (!cuerpo) { toast('El mensaje no puede estar vacío', 'error'); return; }

      guardando = true; btnGuardarMensaje.disabled = true;
      try {
        var url = editMensajeId
          ? '/plantillas/mensajes/' + editMensajeId
          : '/plantillas/eventos/' + mensajeEventoId + '/mensajes';
        var method = editMensajeId ? 'PUT' : 'POST';

        var res, data;
        if (fotoFile) {
          // Enviar como multipart
          var fd = new FormData();
          fd.append('titulo', titulo);
          fd.append('cuerpo', cuerpo);
          fd.append('foto', fotoFile);
          res = await AdminApi.apiFetchForm(url, { method: method, body: fd });
        } else if (fotoQuitada && editMensajeId) {
          // Primero guardar texto, luego borrar foto
          res = await AdminApi.apiFetch(url, { method: method, body: JSON.stringify({ titulo: titulo, cuerpo: cuerpo }) });
          data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Error al guardar');
          await AdminApi.apiFetch('/plantillas/mensajes/' + editMensajeId + '/foto', { method: 'DELETE' });
          toast(editMensajeId ? 'Mensaje actualizado' : 'Mensaje creado', 'success');
          AdminUtils.hideModal('modal-mensaje');
          delete mensajesCache[mensajeEventoId];
          if (openEventoId !== mensajeEventoId) { openEventoId = mensajeEventoId; renderEventos(); }
          await cargarMensajes(mensajeEventoId);
          await cargarEventos();
          return;
        } else {
          res = await AdminApi.apiFetch(url, { method: method, body: JSON.stringify({ titulo: titulo, cuerpo: cuerpo }) });
        }

        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        toast(editMensajeId ? 'Mensaje actualizado' : 'Mensaje creado', 'success');
        AdminUtils.hideModal('modal-mensaje');
        delete mensajesCache[mensajeEventoId];
        if (openEventoId !== mensajeEventoId) { openEventoId = mensajeEventoId; renderEventos(); }
        await cargarMensajes(mensajeEventoId);
        await cargarEventos();
      } catch (e) { toast(e.message || 'Error al guardar mensaje', 'error'); }
      finally { guardando = false; btnGuardarMensaje.disabled = false; }
    }

    async function eliminarMensaje(msgId, eventoId) {
      if (!confirm('¿Eliminar este mensaje?')) return;
      try {
        var res = await AdminApi.apiFetch('/plantillas/mensajes/' + msgId, { method: 'DELETE' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        delete mensajesCache[eventoId];
        toast('Mensaje eliminado', 'success');
        await cargarMensajes(eventoId);
        await cargarEventos();
      } catch (e) { toast(e.message || 'Error al eliminar', 'error'); }
    }

    function abrirModalFoto(msg) {
      fotoModalMsgId = msg.id;
      fotoModalFile = null;
      fotoModalInput.value = '';
      btnFotoModalGuardar.style.display = 'none';
      if (msg.foto_url) {
        fotoModalPreview.innerHTML = '<img src="' + AdminApi.escapeHtml(msg.foto_url) + '" alt="foto actual" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border)">' +
          '<p style="font-size:12px;color:var(--text-muted);margin-top:6px">Foto actual</p>';
        btnFotoModalEliminar.style.display = '';
      } else {
        fotoModalPreview.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sin foto. Selecciona una imagen para subir.</p>';
        btnFotoModalEliminar.style.display = 'none';
      }
      AdminUtils.showModal('modal-foto');
    }

    function descargarFoto(url, nombre) {
      var a = document.createElement('a');
      a.href = url;
      a.download = (nombre || 'foto') + '.jpg';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function copiarMensaje(texto) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () {
          toast('Mensaje copiado al portapapeles', 'success');
        }).catch(function () { fallbackCopy(texto); });
      } else { fallbackCopy(texto); }
    }

    function fallbackCopy(texto) {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Mensaje copiado', 'success'); }
      catch (e) { toast('No se pudo copiar', 'error'); }
      document.body.removeChild(ta);
    }
  });
})();
