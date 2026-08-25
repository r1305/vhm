(function () {
  'use strict';

  var currentPage = 1;
  var totalPages = 1;
  var reclamos = [];
  var detalle = null;
  var respuestaText = '';
  var enviando = false;

  var esc = AdminApi.escapeHtml;
  var fmtDate = AdminUtils.formatDate;
  var fmtDateTime = AdminUtils.formatDateTime;

  function $(id) {
    return document.getElementById(id);
  }

  function badgeClass(estado) {
    return 'badge badge-' + String(estado || '').toLowerCase();
  }

  function renderTable() {
    var body = $('reclamos-body');
    if (!body) return;

    var isSuper = AdminAuth.isSuperAdmin();

    var rows = reclamos.map(function (r) {
      var pdfUrl = AdminApi.apiUrl('/reclamos/' + r.id + '/pdf');
      var actions =
        '<button type="button" class="btn btn-primary btn-xs" data-action="ver" data-id="' + r.id + '">Ver</button> ' +
        '<a class="btn btn-success btn-xs" href="' + esc(pdfUrl) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none">PDF</a>';
      if (r.respuesta) {
        actions += ' <button type="button" class="btn btn-outline btn-xs" data-action="reenviar" data-id="' + r.id + '">📧</button>';
      }
      if (isSuper) {
        actions += ' <button type="button" class="btn btn-danger btn-xs" data-action="delete" data-id="' + r.id + '">🗑</button>';
      }
      return (
        '<tr>' +
          '<td><strong style="color:#667eea">' + esc(r.numero_reclamo) + '</strong></td>' +
          '<td>' + esc(fmtDate(r.fecha_registro)) + '</td>' +
          '<td>' + esc(r.nombres + ' ' + r.apellidos) + '</td>' +
          '<td>' + esc(r.tipo_reclamo) + '</td>' +
          '<td><span class="' + badgeClass(r.estado) + '">' + esc(r.estado) + '</span></td>' +
          '<td>' + (r.respuesta ? '✅ Sí' : '⏳ No') + '</td>' +
          '<td style="font-size:.8rem;color:#888">' + esc(r.respondido_por_nombre || '—') + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>'
      );
    }).join('');

    var emptyRow =
      '<tr><td colspan="8" class="table-empty">' +
        '<div class="empty-icon">📋</div><div class="empty-text">No hay reclamos</div>' +
      '</td></tr>';

    var mobileCards = reclamos.map(function (r) {
      var pdfUrl = AdminApi.apiUrl('/reclamos/' + r.id + '/pdf');
      var actions =
        '<button type="button" class="btn btn-primary btn-xs" data-action="ver" data-id="' + r.id + '">Ver</button> ' +
        '<a class="btn btn-success btn-xs" href="' + esc(pdfUrl) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none">📄 PDF</a>';
      if (r.respuesta) {
        actions += ' <button type="button" class="btn btn-outline btn-xs" data-action="reenviar" data-id="' + r.id + '">📧 Reenviar</button>';
      }
      if (isSuper) {
        actions += ' <button type="button" class="btn btn-danger btn-xs" data-action="delete" data-id="' + r.id + '">🗑 Eliminar</button>';
      }
      return (
        '<div class="mc-item">' +
          '<div class="mc-header">' +
            '<span class="mc-title">' + esc(r.numero_reclamo) + '</span>' +
            '<span class="' + badgeClass(r.estado) + '">' + esc(r.estado) + '</span>' +
          '</div>' +
          '<div class="mc-row">📅 ' + esc(fmtDate(r.fecha_registro)) + '</div>' +
          '<div class="mc-row">👤 ' + esc(r.nombres + ' ' + r.apellidos) + '</div>' +
          '<div class="mc-row">📌 ' + esc(r.tipo_reclamo) + ' · ' + (r.respuesta ? '✅ Respondido' : '⏳ Pendiente') + '</div>' +
          '<div class="mc-actions">' + actions + '</div>' +
        '</div>'
      );
    }).join('');

    var mobileEmpty = reclamos.length
      ? ''
      : '<div style="text-align:center;padding:32px;color:#aaa">📋 No hay reclamos</div>';

    body.innerHTML =
      '<div class="table-desktop"><table><thead><tr>' +
        '<th>N° Reclamo</th><th>Fecha</th><th>Cliente</th><th>Tipo</th>' +
        '<th>Estado</th><th>Resp.</th><th>Respondió</th><th>Acciones</th>' +
      '</tr></thead><tbody>' + (reclamos.length ? rows : emptyRow) + '</tbody></table></div>' +
      '<div class="mobile-cards">' + (mobileCards || mobileEmpty) + '</div>';
  }

  function updateStats(data) {
    var list = data.data || [];
    $('st-total').textContent = data.total != null ? data.total : '—';
    $('st-pend').textContent = data.pendientes != null
      ? data.pendientes
      : list.filter(function (r) { return r.estado === 'PENDIENTE'; }).length;
    $('st-proc').textContent = data.en_proceso != null
      ? data.en_proceso
      : list.filter(function (r) { return r.estado === 'EN_PROCESO'; }).length;
    $('st-res').textContent = data.resueltos != null
      ? data.resueltos
      : list.filter(function (r) { return r.estado === 'RESUELTO'; }).length;
  }

  function updatePagination() {
    $('pg-info').textContent = currentPage + ' / ' + totalPages;
    $('pg-prev').disabled = currentPage <= 1;
    $('pg-next').disabled = currentPage >= totalPages;
  }

  async function cargarReclamos() {
    try {
      var res = await AdminApi.apiFetch(
        '/reclamos?page=' + currentPage + '&limit=10',
        { headers: AdminApi.authHeaders() }
      );
      var data = await res.json();
      reclamos = data.data || [];
      totalPages = data.totalPages || 1;
      if (currentPage > totalPages) {
        currentPage = totalPages;
        return cargarReclamos();
      }
      updateStats(data);
      renderTable();
      updatePagination();
    } catch (e) {
      if (e.message !== 'Sesión expirada') toast('Error cargando reclamos', 'error');
    }
  }

  function renderDetalle() {
    var body = $('detalle-body');
    var btn = $('btn-responder');
    if (!body || !detalle) return;

    var d = detalle;
    var monto = Number(d.monto_reclamado).toFixed(2);
    var respuestaBox = d.respuesta
      ? '<div class="respuesta-box"><span class="rb-label">✅ Respuesta enviada (' +
          esc(fmtDateTime(d.fecha_respuesta)) +
        '):</span><div class="rb-text">' + esc(d.respuesta) + '</div></div>'
      : '';

    var showResponse = !d.respuesta || AdminAuth.isSuperAdmin();
    var responseSection = showResponse
      ? '<div class="response-section"><label for="respuesta-text">Responder al reclamo:</label>' +
          '<textarea id="respuesta-text" rows="4" placeholder="Escribe la respuesta que se notificará al cliente...">' +
          esc(respuestaText) +
          '</textarea></div>'
      : '';

    body.innerHTML =
      '<div class="detail-grid">' +
        '<div class="detail-item"><div class="detail-label">N° Reclamo</div><div class="detail-value">' + esc(d.numero_reclamo) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Fecha</div><div class="detail-value">' + esc(fmtDateTime(d.fecha_registro)) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Cliente</div><div class="detail-value">' + esc(d.nombres + ' ' + d.apellidos) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Documento</div><div class="detail-value">' + esc(d.tipo_documento + ': ' + d.numero_documento) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">' + esc(d.email) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Teléfono</div><div class="detail-value">' + esc(d.telefono) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Dirección</div><div class="detail-value">' + esc(d.direccion + ', ' + d.distrito) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Tipo Bien</div><div class="detail-value">' + esc(d.tipo_bien) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Monto</div><div class="detail-value">S/ ' + esc(monto) + '</div></div>' +
        '<div class="detail-item"><div class="detail-label">Estado</div><div class="detail-value"><span class="' + badgeClass(d.estado) + '">' + esc(d.estado) + '</span></div></div>' +
      '</div>' +
      '<div class="detail-full"><div class="detail-label">Descripción del bien</div><div class="detail-value">' + esc(d.descripcion_bien) + '</div></div>' +
      '<div class="detail-full"><div class="detail-label">Detalle del reclamo</div><div class="detail-value">' + esc(d.detalle_reclamo) + '</div></div>' +
      '<div class="detail-full"><div class="detail-label">Pedido del consumidor</div><div class="detail-value">' + esc(d.pedido_consumidor) + '</div></div>' +
      respuestaBox +
      responseSection;

    if (showResponse) {
      var ta = document.getElementById('respuesta-text');
      if (ta) {
        ta.addEventListener('input', function () {
          respuestaText = ta.value;
        });
      }
      btn.style.display = '';
      btn.disabled = enviando;
      btn.textContent = enviando ? 'Enviando...' : '📨 Enviar respuesta y notificar';
    } else {
      btn.style.display = 'none';
    }
  }

  async function verDetalle(id) {
    try {
      var res = await AdminApi.apiFetch('/reclamos/' + id, { headers: AdminApi.authHeaders() });
      detalle = await res.json();
      respuestaText = detalle.respuesta || '';
      renderDetalle();
      AdminUtils.showModal('modal-detalle');
    } catch (e) {
      if (e.message !== 'Sesión expirada') toast('Error cargando detalle', 'error');
    }
  }

  async function enviarRespuesta() {
    if (!detalle) return;
    if (!respuestaText.trim()) {
      toast('Escribe una respuesta', 'error');
      return;
    }
    enviando = true;
    renderDetalle();
    try {
      var res = await AdminApi.apiFetch('/reclamos/' + detalle.id + '/responder', {
        method: 'POST',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({ respuesta: respuestaText.trim() }),
      });
      var data = await res.json();
      if (res.ok) {
        toast(
          'Respuesta registrada. ' + (data.emailEnviado ? 'Email enviado al cliente.' : 'No se pudo enviar el email.'),
          'success'
        );
        AdminUtils.hideModal('modal-detalle');
        detalle = null;
        cargarReclamos();
      } else {
        toast(data.error || 'Error al enviar respuesta', 'error');
      }
    } catch (e) {
      if (e.message !== 'Sesión expirada') toast('Error de conexión', 'error');
    } finally {
      enviando = false;
      if (detalle) renderDetalle();
    }
  }

  async function eliminarReclamo(id) {
    if (!confirm('¿Eliminar este reclamo? Esta acción no se puede deshacer.')) return;
    try {
      var res = await AdminApi.apiFetch('/reclamos/' + id, {
        method: 'DELETE',
        headers: AdminApi.authHeaders(),
      });
      var data = await res.json();
      if (res.ok) {
        toast('Reclamo eliminado', 'success');
        cargarReclamos();
      } else {
        toast(data.error || 'Error al eliminar', 'error');
      }
    } catch (e) {
      if (e.message !== 'Sesión expirada') toast('Error de conexión', 'error');
    }
  }

  async function reenviarCorreo(id) {
    if (!confirm('¿Reenviar la respuesta por correo al cliente?')) return;
    try {
      var res = await AdminApi.apiFetch('/reclamos/' + id + '/reenviar', {
        method: 'POST',
        headers: AdminApi.authHeaders(),
      });
      var data = await res.json();
      if (res.ok) {
        toast(data.message || 'Correo reenviado', 'success');
      } else {
        toast(data.error || 'Error al reenviar', 'error');
      }
    } catch (e) {
      if (e.message !== 'Sesión expirada') toast('Error de conexión', 'error');
    }
  }

  function cambiarPagina(dir) {
    currentPage += dir;
    if (currentPage < 1) currentPage = 1;
    cargarReclamos();
  }

  function init() {
    AdminLayout.init({ page: 'reclamos', title: '📋 Reclamos' });
    AdminUtils.bindModalClose();

    $('pg-prev').addEventListener('click', function () {
      cambiarPagina(-1);
    });
    $('pg-next').addEventListener('click', function () {
      cambiarPagina(1);
    });
    $('btn-responder').addEventListener('click', enviarRespuesta);

    $('reclamos-body').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      if (action === 'ver') verDetalle(id);
      else if (action === 'reenviar') reenviarCorreo(id);
      else if (action === 'delete') eliminarReclamo(id);
    });

    cargarReclamos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
