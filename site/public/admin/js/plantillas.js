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

    var listEl = document.getElementById('plantillas-list');
    var btnNuevoEvento = document.getElementById('btn-nuevo-evento');
    var modalEventoTitle = document.getElementById('modal-evento-title');
    var evNombre = document.getElementById('ev-nombre');
    var evFecha = document.getElementById('ev-fecha');
    var btnGuardarEvento = document.getElementById('btn-guardar-evento');
    var modalMensajeTitle = document.getElementById('modal-mensaje-title');
    var msgTitulo = document.getElementById('msg-titulo');
    var btnGuardarMensaje = document.getElementById('btn-guardar-mensaje');

    AdminUtils.bindModalClose();

    waEditor = WaEditor.create(document.getElementById('wa-editor-root'), {
      placeholder: 'Escribe el mensaje con formato WhatsApp...',
    });

    btnNuevoEvento.addEventListener('click', function () { abrirModalEvento(); });
    btnGuardarEvento.addEventListener('click', guardarEvento);
    btnGuardarMensaje.addEventListener('click', guardarMensaje);

    cargarEventos();

    async function cargarEventos() {
      try {
        var res = await AdminApi.apiFetch('/plantillas/eventos');
        eventos = await res.json();
        renderEventos();
      } catch (e) {
        toast('Error cargando plantillas', 'error');
      }
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

      bindEventoEvents();
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
          return '<div class="plantilla-msg-card">' +
            '<div class="plantilla-msg-title">' + AdminApi.escapeHtml(m.titulo) + '</div>' +
            '<div class="plantilla-msg-body">' + WaEditor.waToHtml(m.cuerpo) + '</div>' +
            '<div class="plantilla-msg-actions">' +
              '<button type="button" class="btn btn-outline btn-xs" data-copy-msg="' + m.id + '">📋 Copiar</button>' +
              '<button type="button" class="btn btn-primary btn-xs" data-edit-msg="' + m.id + '" data-ev="' + eventoId + '">Editar</button>' +
              '<button type="button" class="btn btn-danger btn-xs" data-del-msg="' + m.id + '" data-ev="' + eventoId + '">Eliminar</button>' +
            '</div>' +
          '</div>';
        }).join('');
    }

    function bindEventoEvents() {
      listEl.querySelectorAll('[data-toggle]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target.closest('button:not(.plantilla-toggle)')) return;
          var id = parseInt(el.getAttribute('data-toggle'), 10);
          toggleEvento(id);
        });
      });

      listEl.querySelectorAll('[data-add-msg]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          abrirModalMensaje(parseInt(btn.getAttribute('data-add-msg'), 10));
        });
      });

      listEl.querySelectorAll('[data-edit-ev]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = parseInt(btn.getAttribute('data-edit-ev'), 10);
          var ev = eventos.find(function (x) { return x.id === id; });
          if (ev) abrirModalEvento(ev);
        });
      });

      listEl.querySelectorAll('[data-del-ev]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          eliminarEvento(parseInt(btn.getAttribute('data-del-ev'), 10));
        });
      });

      listEl.querySelectorAll('[data-edit-msg]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var msgId = parseInt(btn.getAttribute('data-edit-msg'), 10);
          var evId = parseInt(btn.getAttribute('data-ev'), 10);
          var m = (mensajesCache[evId] || []).find(function (x) { return x.id === msgId; });
          if (m) abrirModalMensaje(evId, m);
        });
      });

      listEl.querySelectorAll('[data-del-msg]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          eliminarMensaje(
            parseInt(btn.getAttribute('data-del-msg'), 10),
            parseInt(btn.getAttribute('data-ev'), 10)
          );
        });
      });

      listEl.querySelectorAll('[data-copy-msg]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var msgId = parseInt(btn.getAttribute('data-copy-msg'), 10);
          var evId = openEventoId;
          var m = (mensajesCache[evId] || []).find(function (x) { return x.id === msgId; });
          if (m) copiarMensaje(m.cuerpo);
        });
      });
    }

    async function toggleEvento(id) {
      if (openEventoId === id) {
        openEventoId = null;
        renderEventos();
        return;
      }
      openEventoId = id;
      renderEventos();
      if (!mensajesCache[id]) {
        await cargarMensajes(id);
      } else {
        var detail = document.getElementById('detail-' + id);
        if (detail) detail.innerHTML = renderMensajesHtml(id);
        bindEventoEvents();
      }
    }

    async function cargarMensajes(eventoId) {
      try {
        var res = await AdminApi.apiFetch('/plantillas/eventos/' + eventoId + '/mensajes');
        mensajesCache[eventoId] = await res.json();
        var detail = document.getElementById('detail-' + eventoId);
        if (detail) detail.innerHTML = renderMensajesHtml(eventoId);
        bindEventoEvents();
      } catch (e) {
        toast('Error cargando mensajes', 'error');
      }
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

      guardando = true;
      btnGuardarEvento.disabled = true;
      try {
        var url = editEventoId
          ? '/plantillas/eventos/' + editEventoId
          : '/plantillas/eventos';
        var method = editEventoId ? 'PUT' : 'POST';
        var res = await AdminApi.apiFetch(url, {
          method: method,
          body: JSON.stringify({ nombre: nombre, fecha: fecha }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        toast(editEventoId ? 'Evento actualizado' : 'Evento creado', 'success');
        AdminUtils.hideModal('modal-evento');
        await cargarEventos();
        if (openEventoId) {
          var detail = document.getElementById('detail-' + openEventoId);
          if (detail && mensajesCache[openEventoId]) {
            detail.innerHTML = renderMensajesHtml(openEventoId);
            bindEventoEvents();
          }
        }
      } catch (e) {
        toast(e.message || 'Error al guardar evento', 'error');
      } finally {
        guardando = false;
        btnGuardarEvento.disabled = false;
      }
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
      } catch (e) {
        toast(e.message || 'Error al eliminar', 'error');
      }
    }

    function abrirModalMensaje(eventoId, msg) {
      mensajeEventoId = eventoId;
      editMensajeId = msg ? msg.id : null;
      modalMensajeTitle.textContent = msg ? '💬 Editar mensaje' : '💬 Nuevo mensaje';
      msgTitulo.value = msg ? msg.titulo : '';
      waEditor.setValue(msg ? msg.cuerpo : '');
      AdminUtils.showModal('modal-mensaje');
      msgTitulo.focus();
    }

    async function guardarMensaje() {
      if (guardando) return;
      var titulo = msgTitulo.value.trim();
      var cuerpo = waEditor.getValue().trim();
      if (!titulo) { toast('Ingresa el título del mensaje', 'error'); return; }
      if (!cuerpo) { toast('El mensaje no puede estar vacío', 'error'); return; }

      guardando = true;
      btnGuardarMensaje.disabled = true;
      try {
        var url = editMensajeId
          ? '/plantillas/mensajes/' + editMensajeId
          : '/plantillas/eventos/' + mensajeEventoId + '/mensajes';
        var method = editMensajeId ? 'PUT' : 'POST';
        var res = await AdminApi.apiFetch(url, {
          method: method,
          body: JSON.stringify({ titulo: titulo, cuerpo: cuerpo }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        toast(editMensajeId ? 'Mensaje actualizado' : 'Mensaje creado', 'success');
        AdminUtils.hideModal('modal-mensaje');
        delete mensajesCache[mensajeEventoId];
        if (openEventoId !== mensajeEventoId) {
          openEventoId = mensajeEventoId;
          renderEventos();
        }
        await cargarMensajes(mensajeEventoId);
        await cargarEventos();
      } catch (e) {
        toast(e.message || 'Error al guardar mensaje', 'error');
      } finally {
        guardando = false;
        btnGuardarMensaje.disabled = false;
      }
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
      } catch (e) {
        toast(e.message || 'Error al eliminar', 'error');
      }
    }

    function copiarMensaje(texto) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () {
          toast('Mensaje copiado al portapapeles', 'success');
        }).catch(function () {
          fallbackCopy(texto);
        });
      } else {
        fallbackCopy(texto);
      }
    }

    function fallbackCopy(texto) {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('Mensaje copiado', 'success');
      } catch (e) {
        toast('No se pudo copiar', 'error');
      }
      document.body.removeChild(ta);
    }
  });
})();
