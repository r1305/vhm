(function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var tabsLoaded = {};

  /* ── state: videos ── */
  var videos = [];
  var videoSearch = '';
  var videoCategory = '';
  var videoSort = 'titulo';
  var videoOrder = 'asc';
  var videoPage = 1;
  var videoTotalPages = 1;
  var categorias = [];
  var editandoVideoId = null;
  var thumbFile = null;
  var eliminarThumb = false;

  /* ── state: categorias tab ── */
  var categoriasAdmin = [];
  var editandoCategoriaId = null;

  /* ── state: eventos ── */
  var eventos = [];
  var eventosMes = String(new Date().getMonth() + 1).padStart(2, '0');
  var editandoEventoId = null;

  /* ── helpers ── */
  function nFmt(n) {
    return (n || 0).toLocaleString('es');
  }

  function fmtHora(t) {
    if (!t) return '—';
    return String(t).slice(0, 5);
  }

  function esLoomUrl(url) {
    return /loom\.com\/(?:share|embed)\/[0-9a-f]{32}/i.test(url || '');
  }

  function sortIcon(col) {
    if (videoSort !== col) return '';
    return videoOrder === 'asc' ? '▲' : '▼';
  }

  function updateSortIcons() {
    document.querySelectorAll('.sort-icon').forEach(function (el) {
      var col = el.getAttribute('data-col');
      el.textContent = sortIcon(col);
    });
  }

  function fillCategoriaSelects(list) {
    var opts = '<option value="">Todas las categorías</option>';
    var optsModal = '<option value="">— Sin categoría —</option>';
    (list || []).forEach(function (c) {
      var o = '<option value="' + c.id + '">' + AdminApi.escapeHtml(c.nombre) + '</option>';
      opts += o;
      optsModal += o;
    });
    var selFilter = document.getElementById('vid-categoria');
    var selModal = document.getElementById('vf-categoria_id');
    if (selFilter) {
      var prev = selFilter.value;
      selFilter.innerHTML = opts;
      selFilter.value = prev;
    }
    if (selModal) {
      var prevM = selModal.value;
      selModal.innerHTML = optsModal;
      selModal.value = prevM;
    }
  }

  function emptyRow(colspan, icon, text) {
    return '<tr><td colspan="' + colspan + '" class="table-empty"><div class="empty-icon">' + icon + '</div><div class="empty-text">' + AdminApi.escapeHtml(text) + '</div></td></tr>';
  }

  function eventosFiltrados() {
    var mes = eventosMes;
    var anio = new Date().getFullYear();
    return eventos.filter(function (e) {
      var f = new Date(e.fecha);
      var eMes = String(f.getMonth() + 1).padStart(2, '0');
      return eMes === mes && f.getFullYear() === anio;
    });
  }

  /* ── RESUMEN ── */
  async function cargarStats() {
    try {
      var params = new URLSearchParams();
      var desde = document.getElementById('res-fecha-desde').value;
      var hasta = document.getElementById('res-fecha-hasta').value;
      if (desde) params.set('fecha_desde', desde);
      if (hasta) params.set('fecha_hasta', hasta);
      var qs = params.toString();
      var res = await AdminApi.apiFetch('/videos/stats' + (qs ? '?' + qs : ''), { headers: AdminApi.authHeaders() });
      var d = await res.json();
      document.getElementById('st-total-videos').textContent = d.totalVideos != null ? d.totalVideos : '—';
      document.getElementById('st-total-views').textContent = nFmt(d.totalViews);
      document.getElementById('st-total-likes').textContent = nFmt(d.totalLikes);
      document.getElementById('st-prom-vistas').textContent = d.totalVideos
        ? (d.totalViews / d.totalVideos).toFixed(1)
        : '—';
      renderTopList('top-views', d.topByViews || [], false);
      renderTopList('top-likes', d.topByLikes || [], true);
    } catch (e) {
      toast('No se pudieron cargar las estadísticas', 'error');
    }
  }

  function renderTopList(containerId, items, showHeart) {
    var el = document.getElementById(containerId);
    if (!items.length) {
      el.innerHTML = '<div class="table-empty"><div class="empty-icon">' + (showHeart ? '❤️' : '👁️') + '</div><div class="empty-text">Sin datos</div></div>';
      return;
    }
    el.innerHTML = items.map(function (v, i) {
      return '<div class="top-row">' +
        '<span class="top-rank">' + (i + 1) + '</span>' +
        '<span class="top-title">' + AdminApi.escapeHtml(v.titulo) + '</span>' +
        '<span class="top-num">' + (showHeart ? '❤️ ' : '') + nFmt(showHeart ? v.likes : v.vistas) + '</span>' +
        '</div>';
    }).join('');
  }

  function limpiarFiltrosResumen() {
    document.getElementById('res-fecha-desde').value = '';
    document.getElementById('res-fecha-hasta').value = '';
    cargarStats();
  }

  /* ── VIDEOS ── */
  async function cargarCategorias() {
    try {
      var res = await AdminApi.apiFetch('/videos/categorias/admin', { headers: AdminApi.authHeaders() });
      categorias = await res.json();
      fillCategoriaSelects(categorias);
    } catch (e) { /* optional */ }
  }

  async function cargarVideos() {
    try {
      var qs = 'search=' + encodeURIComponent(videoSearch) +
        '&categoria_id=' + encodeURIComponent(videoCategory) +
        '&sort=' + encodeURIComponent(videoSort) +
        '&order=' + encodeURIComponent(videoOrder) +
        '&page=' + videoPage +
        '&limit=10';
      var res = await AdminApi.apiFetch('/videos/admin?' + qs, { headers: AdminApi.authHeaders() });
      var data = await res.json();
      videos = data.data || [];
      videoTotalPages = data.totalPages || 1;
      renderVideos();
      updateSortIcons();
      document.getElementById('vid-pg-info').textContent = 'Pág. ' + videoPage + ' de ' + videoTotalPages;
      document.getElementById('vid-pg-prev').disabled = videoPage <= 1;
      document.getElementById('vid-pg-next').disabled = videoPage >= videoTotalPages;
    } catch (e) {
      toast('Error cargando videos', 'error');
    }
  }

  function renderVideos() {
    var tbody = document.getElementById('videos-tbody');
    var mobile = document.getElementById('videos-mobile');
    if (!videos.length) {
      tbody.innerHTML = emptyRow(9, '🎬', 'No hay videos');
      mobile.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">🎬 No hay videos</div>';
      return;
    }
    tbody.innerHTML = videos.map(function (v) {
      var thumb = v.thumbnail_url
        ? '<img src="' + AdminApi.escapeHtml(v.thumbnail_url) + '" class="thumb" alt="">'
        : '🎬';
      return '<tr>' +
        '<td>' + thumb + '</td>' +
        '<td style="color:var(--color-primary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">' + AdminApi.escapeHtml(v.titulo) + '</td>' +
        '<td>' + AdminApi.escapeHtml(v.categoria_nombre || '—') + '</td>' +
        '<td>' + AdminApi.escapeHtml(v.duracion || '—') + '</td>' +
        '<td>' + (v.vistas != null ? v.vistas : 0) + '</td>' +
        '<td>' + (v.likes != null ? v.likes : 0) + '</td>' +
        '<td>' + (v.activo ? '✅' : '❌') + '</td>' +
        '<td style="font-size:.8rem;color:var(--text-muted)">' + AdminApi.escapeHtml(v.creado_por_nombre || '—') + '</td>' +
        '<td>' +
          '<button type="button" class="btn btn-primary btn-xs" data-action="edit-video" data-id="' + v.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-action="del-video" data-id="' + v.id + '">Eliminar</button>' +
        '</td></tr>';
    }).join('');
    mobile.innerHTML = videos.map(function (v) {
      return '<div class="mc-item">' +
        '<div class="mc-header"><span class="mc-title">' + AdminApi.escapeHtml(v.titulo) + '</span>' + (v.activo ? '✅' : '❌') + '</div>' +
        '<div class="mc-row">🗂️ ' + AdminApi.escapeHtml(v.categoria_nombre || 'Sin categoría') + ' · ⏱️ ' + AdminApi.escapeHtml(v.duracion || '—') + '</div>' +
        '<div class="mc-row">👁️ ' + (v.vistas || 0) + ' vistas · ❤️ ' + (v.likes || 0) + ' likes</div>' +
        '<div class="mc-actions">' +
          '<button type="button" class="btn btn-primary btn-xs" data-action="edit-video" data-id="' + v.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-action="del-video" data-id="' + v.id + '">Eliminar</button>' +
        '</div></div>';
    }).join('');
  }

  function mostrarModalVideo() {
    editandoVideoId = null;
    document.getElementById('modal-video-title').textContent = '🎬 Nuevo Video';
    document.getElementById('vf-titulo').value = '';
    document.getElementById('vf-subtitulo').value = '';
    document.getElementById('vf-categoria_id').value = '';
    document.getElementById('vf-video_url').value = '';
    document.getElementById('vf-duracion').value = '';
    document.getElementById('vf-descripcion').value = '';
    document.getElementById('vf-activo').value = '1';
    thumbFile = null;
    eliminarThumb = false;
    document.getElementById('vf-thumbnail').value = '';
    document.getElementById('vf-thumb-preview').style.display = 'none';
    AdminUtils.showModal('modal-video');
  }

  function editarVideo(v) {
    editandoVideoId = v.id;
    document.getElementById('modal-video-title').textContent = '✏️ Editar Video';
    document.getElementById('vf-titulo').value = v.titulo || '';
    document.getElementById('vf-subtitulo').value = v.subtitulo || '';
    document.getElementById('vf-categoria_id').value = v.categoria_id || '';
    document.getElementById('vf-video_url').value = v.video_url || '';
    document.getElementById('vf-duracion').value = v.duracion || '';
    document.getElementById('vf-descripcion').value = v.descripcion || '';
    document.getElementById('vf-activo').value = v.activo ? '1' : '0';
    thumbFile = null;
    eliminarThumb = false;
    document.getElementById('vf-thumbnail').value = '';
    var preview = document.getElementById('vf-thumb-preview');
    var img = document.getElementById('vf-thumb-img');
    if (v.thumbnail_url) {
      img.src = v.thumbnail_url;
      preview.style.display = 'flex';
    } else {
      preview.style.display = 'none';
    }
    AdminUtils.showModal('modal-video');
  }

  async function guardarVideo() {
    var titulo = document.getElementById('vf-titulo').value;
    var videoUrl = document.getElementById('vf-video_url').value.trim();
    if (!videoUrl) return toast('El enlace del video es obligatorio', 'error');
    if (!titulo && !esLoomUrl(videoUrl)) return toast('El título es obligatorio (solo se autocompleta con Loom)', 'error');

    var fd = new FormData();
    fd.append('titulo', titulo);
    fd.append('subtitulo', document.getElementById('vf-subtitulo').value);
    fd.append('categoria_id', document.getElementById('vf-categoria_id').value);
    fd.append('video_url', videoUrl);
    fd.append('duracion', document.getElementById('vf-duracion').value);
    fd.append('descripcion', document.getElementById('vf-descripcion').value);
    fd.append('activo', document.getElementById('vf-activo').value);
    if (thumbFile) fd.append('thumbnail', thumbFile);
    if (eliminarThumb) fd.append('eliminar_thumbnail', 'true');

    var btn = document.getElementById('btn-guardar-video');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      var url = editandoVideoId ? '/videos/' + editandoVideoId : '/videos';
      var res = await AdminApi.apiFetch(url, {
        method: editandoVideoId ? 'PUT' : 'POST',
        headers: AdminApi.formHeaders(),
        body: fd,
      });
      var data = await res.json();
      if (res.ok) {
        AdminUtils.hideModal('modal-video');
        cargarVideos();
        toast('Video guardado', 'success');
      } else {
        toast(data.error || 'Error al guardar', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar';
    }
  }

  async function eliminarVideo(id) {
    if (!confirm('¿Eliminar este video?')) return;
    try {
      var res = await AdminApi.apiFetch('/videos/' + id, { method: 'DELETE', headers: AdminApi.authHeaders() });
      var data = await res.json();
      if (res.ok) {
        cargarVideos();
        toast('Video eliminado', 'success');
      } else {
        toast(data.error || 'Error', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    }
  }

  function sortVideos(col) {
    if (videoSort === col) {
      videoOrder = videoOrder === 'asc' ? 'desc' : 'asc';
    } else {
      videoSort = col;
      videoOrder = 'asc';
    }
    videoPage = 1;
    cargarVideos();
  }

  function buscarVideos() {
    videoSearch = document.getElementById('vid-search').value;
    videoCategory = document.getElementById('vid-categoria').value;
    videoPage = 1;
    cargarVideos();
  }

  /* ── CATEGORÍAS ── */
  async function cargarCategoriasAdmin() {
    try {
      var res = await AdminApi.apiFetch('/videos/categorias/admin', { headers: AdminApi.authHeaders() });
      categoriasAdmin = await res.json();
      renderCategorias();
    } catch (e) { /* silent */ }
  }

  function renderCategorias() {
    var tbody = document.getElementById('cat-tbody');
    var mobile = document.getElementById('cat-mobile');
    if (!categoriasAdmin.length) {
      tbody.innerHTML = emptyRow(7, '🗂️', 'No hay categorías');
      mobile.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">🗂️ No hay categorías</div>';
      return;
    }
    tbody.innerHTML = categoriasAdmin.map(function (c) {
      return '<tr>' +
        '<td style="color:var(--color-primary);font-weight:500">' + AdminApi.escapeHtml(c.nombre) + '</td>' +
        '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + AdminApi.escapeHtml(c.descripcion || '—') + '</td>' +
        '<td>' + (c.total_videos != null ? c.total_videos : 0) + '</td>' +
        '<td>' + (c.orden != null ? c.orden : '—') + '</td>' +
        '<td style="font-size:.8rem;color:var(--text-muted)">' + AdminApi.escapeHtml(c.creado_por_nombre || '—') + '</td>' +
        '<td>' + (c.activo ? '✅' : '❌') + '</td>' +
        '<td>' +
          '<button type="button" class="btn btn-primary btn-xs" data-action="edit-cat" data-id="' + c.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-action="del-cat" data-id="' + c.id + '">Eliminar</button>' +
        '</td></tr>';
    }).join('');
    mobile.innerHTML = categoriasAdmin.map(function (c) {
      return '<div class="mc-item">' +
        '<div class="mc-header"><span class="mc-title">' + AdminApi.escapeHtml(c.nombre) + '</span>' + (c.activo ? '✅' : '❌') + '</div>' +
        '<div class="mc-row">' + AdminApi.escapeHtml(c.descripcion || 'Sin descripción') + '</div>' +
        '<div class="mc-row">🎬 ' + (c.total_videos || 0) + ' videos · Orden: ' + (c.orden || '—') + '</div>' +
        '<div class="mc-actions">' +
          '<button type="button" class="btn btn-primary btn-xs" data-action="edit-cat" data-id="' + c.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-action="del-cat" data-id="' + c.id + '">Eliminar</button>' +
        '</div></div>';
    }).join('');
  }

  function mostrarModalCategoria() {
    editandoCategoriaId = null;
    document.getElementById('modal-categoria-title').textContent = '🗂️ Nueva Categoría';
    document.getElementById('cf-nombre').value = '';
    document.getElementById('cf-descripcion').value = '';
    document.getElementById('cf-orden').value = '1';
    document.getElementById('cf-activo').value = '1';
    AdminUtils.showModal('modal-categoria');
  }

  function editarCategoria(c) {
    editandoCategoriaId = c.id;
    document.getElementById('modal-categoria-title').textContent = '✏️ Editar Categoría';
    document.getElementById('cf-nombre').value = c.nombre || '';
    document.getElementById('cf-descripcion').value = c.descripcion || '';
    document.getElementById('cf-orden').value = c.orden || 1;
    document.getElementById('cf-activo').value = c.activo ? '1' : '0';
    AdminUtils.showModal('modal-categoria');
  }

  async function guardarCategoria() {
    var nombre = document.getElementById('cf-nombre').value.trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    var body = {
      nombre: nombre,
      descripcion: document.getElementById('cf-descripcion').value.trim(),
      orden: parseInt(document.getElementById('cf-orden').value, 10) || 1,
      activo: document.getElementById('cf-activo').value === '1',
    };
    var btn = document.getElementById('btn-guardar-categoria');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      var url = editandoCategoriaId ? '/videos/categorias/' + editandoCategoriaId : '/videos/categorias';
      var res = await AdminApi.apiFetch(url, {
        method: editandoCategoriaId ? 'PUT' : 'POST',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      var data = await res.json();
      if (res.ok) {
        AdminUtils.hideModal('modal-categoria');
        cargarCategoriasAdmin();
        tabsLoaded.videos = false;
        toast('Categoría guardada', 'success');
      } else {
        toast(data.error || 'Error', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar';
    }
  }

  async function eliminarCategoria(id) {
    if (!confirm('¿Eliminar esta categoría? Los videos asociados quedarán sin categoría.')) return;
    try {
      var res = await AdminApi.apiFetch('/videos/categorias/' + id, { method: 'DELETE', headers: AdminApi.authHeaders() });
      var data = await res.json();
      if (res.ok) {
        cargarCategoriasAdmin();
        tabsLoaded.videos = false;
        toast('Categoría eliminada', 'success');
      } else {
        toast(data.error || 'Error', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    }
  }

  /* ── TEXTOS (landing) ── */
  async function cargarLanding() {
    try {
      var res = await AdminApi.apiFetch('/videos/landing', { headers: AdminApi.authHeaders() });
      var cfg = await res.json();
      document.getElementById('landing-intro').value = cfg.intro || '';
      document.getElementById('landing-pacto').value = cfg.pacto || '';
    } catch (e) {
      toast('No se pudo cargar el landing', 'error');
    }
  }

  async function guardarLanding() {
    var intro = document.getElementById('landing-intro').value.trim();
    var pacto = document.getElementById('landing-pacto').value.trim();
    if (!intro || !pacto) return toast('Ambos textos son obligatorios', 'error');
    try {
      var res = await AdminApi.apiFetch('/videos/landing', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({ intro: intro, pacto: pacto }),
      });
      var d = await res.json();
      toast(res.ok ? 'Textos guardados' : (d.error || 'Error'), res.ok ? 'success' : 'error');
    } catch (e) {
      toast('Error de conexión', 'error');
    }
  }

  /* ── EVENTOS ── */
  async function cargarEventos() {
    try {
      var res = await AdminApi.apiFetch('/eventos/admin', { headers: AdminApi.authHeaders() });
      eventos = await res.json();
      renderEventos();
    } catch (e) {
      toast('No se pudieron cargar los eventos', 'error');
    }
  }

  function renderEventos() {
    var list = eventosFiltrados();
    var tbody = document.getElementById('evt-tbody');
    var mobile = document.getElementById('evt-mobile');
    if (!list.length) {
      tbody.innerHTML = emptyRow(8, '📅', 'No hay eventos este mes');
      mobile.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">📅 No hay eventos este mes</div>';
      return;
    }
    tbody.innerHTML = list.map(function (e) {
      return '<tr>' +
        '<td style="color:var(--color-primary);font-weight:500">' + AdminApi.escapeHtml(e.nombre) + '</td>' +
        '<td>' + AdminApi.escapeHtml(String(e.fecha).slice(0, 10)) + '</td>' +
        '<td>' + fmtHora(e.hora_inicio) + '</td>' +
        '<td>' + fmtHora(e.hora_fin) + '</td>' +
        '<td>' + AdminApi.escapeHtml(e.lugar) + '</td>' +
        '<td style="font-size:.8rem;color:var(--text-muted)">' + AdminApi.escapeHtml(e.creado_por_nombre || '—') + '</td>' +
        '<td>' + (e.activo ? '✅' : '❌') + '</td>' +
        '<td>' +
          '<button type="button" class="btn btn-primary btn-xs" data-action="edit-evt" data-id="' + e.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-outline btn-xs" data-action="copy-evt" data-id="' + e.id + '">Copiar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-action="del-evt" data-id="' + e.id + '">Eliminar</button>' +
        '</td></tr>';
    }).join('');
    mobile.innerHTML = list.map(function (e) {
      return '<div class="mc-item">' +
        '<div class="mc-header"><span class="mc-title">' + AdminApi.escapeHtml(e.nombre) + '</span>' + (e.activo ? '✅' : '❌') + '</div>' +
        '<div class="mc-row">📅 ' + AdminApi.escapeHtml(String(e.fecha).slice(0, 10)) + ' · 🕐 ' + fmtHora(e.hora_inicio) +
          (e.hora_fin ? ' – ' + fmtHora(e.hora_fin) : '') + '</div>' +
        '<div class="mc-row">📍 ' + AdminApi.escapeHtml(e.lugar) + '</div>' +
        '<div class="mc-actions">' +
          '<button type="button" class="btn btn-primary btn-xs" data-action="edit-evt" data-id="' + e.id + '">Editar</button> ' +
          '<button type="button" class="btn btn-outline btn-xs" data-action="copy-evt" data-id="' + e.id + '">Copiar</button> ' +
          '<button type="button" class="btn btn-danger btn-xs" data-action="del-evt" data-id="' + e.id + '">Eliminar</button>' +
        '</div></div>';
    }).join('');
  }

  function resetEventoForm() {
    document.getElementById('ef-nombre').value = '';
    document.getElementById('ef-fecha').value = '';
    document.getElementById('ef-hora_inicio').value = '';
    document.getElementById('ef-hora_fin').value = '';
    document.getElementById('ef-lugar').value = '';
    document.getElementById('ef-ubicacion').value = '';
    document.getElementById('ef-activo').value = '1';
  }

  function mostrarModalEvento() {
    editandoEventoId = null;
    document.getElementById('modal-evento-title').textContent = '📅 Nuevo Evento';
    resetEventoForm();
    AdminUtils.showModal('modal-evento');
  }

  function findEvento(id) {
    return eventos.find(function (e) { return String(e.id) === String(id); });
  }

  function editarEvento(e) {
    editandoEventoId = e.id;
    document.getElementById('modal-evento-title').textContent = '✏️ Editar Evento';
    document.getElementById('ef-nombre').value = e.nombre || '';
    document.getElementById('ef-fecha').value = String(e.fecha).slice(0, 10);
    document.getElementById('ef-hora_inicio').value = fmtHora(e.hora_inicio);
    document.getElementById('ef-hora_fin').value = e.hora_fin ? fmtHora(e.hora_fin) : '';
    document.getElementById('ef-lugar').value = e.lugar || '';
    document.getElementById('ef-ubicacion').value = e.ubicacion || '';
    document.getElementById('ef-activo').value = e.activo ? '1' : '0';
    AdminUtils.showModal('modal-evento');
  }

  function copiarEvento(e) {
    editandoEventoId = null;
    document.getElementById('modal-evento-title').textContent = '📅 Nuevo Evento (copia)';
    document.getElementById('ef-nombre').value = e.nombre || '';
    document.getElementById('ef-fecha').value = '';
    document.getElementById('ef-hora_inicio').value = fmtHora(e.hora_inicio);
    document.getElementById('ef-hora_fin').value = e.hora_fin ? fmtHora(e.hora_fin) : '';
    document.getElementById('ef-lugar').value = e.lugar || '';
    document.getElementById('ef-ubicacion').value = e.ubicacion || '';
    document.getElementById('ef-activo').value = e.activo ? '1' : '0';
    AdminUtils.showModal('modal-evento');
  }

  async function guardarEvento() {
    var nombre = document.getElementById('ef-nombre').value.trim();
    var fecha = document.getElementById('ef-fecha').value;
    var horaInicio = document.getElementById('ef-hora_inicio').value;
    var lugar = document.getElementById('ef-lugar').value.trim();
    if (!nombre || !fecha || !horaInicio || !lugar) {
      return toast('Completa nombre, fecha, hora de inicio y lugar', 'error');
    }
    var horaFin = document.getElementById('ef-hora_fin').value;
    var ubicacion = document.getElementById('ef-ubicacion').value.trim();
    var body = {
      nombre: nombre,
      fecha: fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin || null,
      lugar: lugar,
      ubicacion: ubicacion || null,
      activo: document.getElementById('ef-activo').value === '1',
    };
    var btn = document.getElementById('btn-guardar-evento');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      var url = editandoEventoId ? '/eventos/' + editandoEventoId : '/eventos';
      var res = await AdminApi.apiFetch(url, {
        method: editandoEventoId ? 'PUT' : 'POST',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      var d = await res.json();
      if (res.ok) {
        AdminUtils.hideModal('modal-evento');
        cargarEventos();
        toast('Evento guardado', 'success');
      } else {
        toast(d.error || 'Error al guardar', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar';
    }
  }

  async function eliminarEvento(id) {
    if (!confirm('¿Eliminar este evento?')) return;
    try {
      var res = await AdminApi.apiFetch('/eventos/' + id, { method: 'DELETE', headers: AdminApi.authHeaders() });
      var data = await res.json();
      if (res.ok) {
        cargarEventos();
        toast('Evento eliminado', 'success');
      } else {
        toast(data.error || 'Error', 'error');
      }
    } catch (e) {
      toast('Error de conexión', 'error');
    }
  }

  /* ── ACCESO ── */
  var accCopiadoTimer = null;

  function updateAccesoLabel(activo) {
    document.getElementById('acc-estado-label').textContent = activo
      ? '🔒 La Tribu requiere contraseña'
      : '🔓 Acceso libre';
  }

  async function cargarAcceso() {
    try {
      var res = await AdminApi.apiFetch('/tribu-access/config', { headers: AdminApi.authHeaders() });
      var d = await res.json();
      document.getElementById('acc-activo').checked = !!d.activo;
      document.getElementById('acc-password').textContent = d.password || '—';
      document.getElementById('acc-mensaje').value = d.mensaje || '';
      document.getElementById('acc-fecha-renovacion').textContent = d.fecha_renovacion
        ? AdminUtils.formatDateTime(d.fecha_renovacion)
        : '—';
      updateAccesoLabel(!!d.activo);
    } catch (e) {
      AdminUtils.mostrarMsg(document.getElementById('acc-msg'), 'Error al cargar', false);
    }
  }

  async function guardarAcceso() {
    var btn = document.getElementById('btn-acc-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      var res = await AdminApi.apiFetch('/tribu-access/config', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({
          activo: document.getElementById('acc-activo').checked,
          mensaje: document.getElementById('acc-mensaje').value,
        }),
      });
      var d = await res.json();
      AdminUtils.mostrarMsg(document.getElementById('acc-msg'), res.ok ? d.message : d.error, res.ok);
      updateAccesoLabel(document.getElementById('acc-activo').checked);
    } catch (e) {
      AdminUtils.mostrarMsg(document.getElementById('acc-msg'), 'Error de conexión', false);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar';
    }
  }

  async function renovarAcceso() {
    if (!confirm('¿Renovar la contraseña ahora? La anterior dejará de funcionar.')) return;
    var btn = document.getElementById('btn-acc-renovar');
    btn.disabled = true;
    btn.textContent = 'Renovando...';
    try {
      var res = await AdminApi.apiFetch('/tribu-access/renovar', { method: 'POST', headers: AdminApi.authHeaders() });
      var d = await res.json();
      if (res.ok) {
        document.getElementById('acc-password').textContent = d.password || '—';
        toast('Contraseña renovada', 'success');
      } else {
        AdminUtils.mostrarMsg(document.getElementById('acc-msg'), d.error, false);
      }
    } catch (e) {
      AdminUtils.mostrarMsg(document.getElementById('acc-msg'), 'Error de conexión', false);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Renovar contraseña ahora';
    }
  }

  async function copiarPassword() {
    var pwd = document.getElementById('acc-password').textContent;
    if (!pwd || pwd === '—') return;
    try {
      await navigator.clipboard.writeText(pwd);
      var btn = document.getElementById('btn-acc-copiar');
      btn.textContent = '✅ Copiado';
      if (accCopiadoTimer) clearTimeout(accCopiadoTimer);
      accCopiadoTimer = setTimeout(function () {
        btn.textContent = '📋 Copiar';
      }, 2000);
    } catch (e) {
      toast('No se pudo copiar', 'error');
    }
  }

  /* ── lazy tab loader ── */
  window.onAdminTabChange = function (tab) {
    if (tabsLoaded[tab]) return;
    tabsLoaded[tab] = true;
    if (tab === 'resumen') cargarStats();
    else if (tab === 'videos') { cargarCategorias(); cargarVideos(); }
    else if (tab === 'categorias') cargarCategoriasAdmin();
    else if (tab === 'textos') cargarLanding();
    else if (tab === 'eventos') cargarEventos();
    else if (tab === 'acceso') cargarAcceso();
  };

  function initMesSelect() {
    var sel = document.getElementById('evt-mes');
    sel.innerHTML = MESES.map(function (m, i) {
      var val = String(i + 1).padStart(2, '0');
      return '<option value="' + val + '">' + m + '</option>';
    }).join('');
    sel.value = eventosMes;
  }

  function bindEvents() {
    document.getElementById('btn-res-filtrar').addEventListener('click', cargarStats);
    document.getElementById('btn-res-limpiar').addEventListener('click', limpiarFiltrosResumen);

    document.getElementById('btn-vid-buscar').addEventListener('click', buscarVideos);
    document.getElementById('vid-search').addEventListener('keypress', function (e) {
      if (e.key === 'Enter') buscarVideos();
    });
    document.getElementById('btn-nuevo-video').addEventListener('click', mostrarModalVideo);
    document.getElementById('btn-guardar-video').addEventListener('click', guardarVideo);
    document.getElementById('vid-pg-prev').addEventListener('click', function () {
      if (videoPage > 1) { videoPage--; cargarVideos(); }
    });
    document.getElementById('vid-pg-next').addEventListener('click', function () {
      if (videoPage < videoTotalPages) { videoPage++; cargarVideos(); }
    });

    document.querySelectorAll('[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        sortVideos(th.getAttribute('data-sort'));
      });
    });

    document.getElementById('videos-tbody').addEventListener('click', onVideoTableClick);
    document.getElementById('videos-mobile').addEventListener('click', onVideoTableClick);

    document.getElementById('vf-thumbnail').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      thumbFile = file;
      eliminarThumb = false;
      var reader = new FileReader();
      reader.onload = function (ev) {
        document.getElementById('vf-thumb-img').src = ev.target.result;
        document.getElementById('vf-thumb-preview').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('btn-quitar-thumb').addEventListener('click', function () {
      thumbFile = null;
      eliminarThumb = true;
      document.getElementById('vf-thumbnail').value = '';
      document.getElementById('vf-thumb-preview').style.display = 'none';
    });

    document.getElementById('btn-nueva-categoria').addEventListener('click', mostrarModalCategoria);
    document.getElementById('btn-guardar-categoria').addEventListener('click', guardarCategoria);
    document.getElementById('cat-tbody').addEventListener('click', onCatTableClick);
    document.getElementById('cat-mobile').addEventListener('click', onCatTableClick);

    document.getElementById('btn-guardar-landing').addEventListener('click', guardarLanding);

    document.getElementById('evt-mes').addEventListener('change', function () {
      eventosMes = this.value;
      renderEventos();
    });
    document.getElementById('btn-nuevo-evento').addEventListener('click', mostrarModalEvento);
    document.getElementById('btn-guardar-evento').addEventListener('click', guardarEvento);
    document.getElementById('evt-tbody').addEventListener('click', onEvtTableClick);
    document.getElementById('evt-mobile').addEventListener('click', onEvtTableClick);

    document.getElementById('acc-activo').addEventListener('change', function () {
      updateAccesoLabel(this.checked);
      guardarAcceso();
    });
    document.getElementById('btn-acc-guardar').addEventListener('click', guardarAcceso);
    document.getElementById('btn-acc-renovar').addEventListener('click', renovarAcceso);
    document.getElementById('btn-acc-copiar').addEventListener('click', copiarPassword);
  }

  function onVideoTableClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    if (action === 'edit-video') {
      var v = videos.find(function (x) { return String(x.id) === String(id); });
      if (v) editarVideo(v);
    } else if (action === 'del-video') {
      eliminarVideo(id);
    }
  }

  function onCatTableClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    if (action === 'edit-cat') {
      var c = categoriasAdmin.find(function (x) { return String(x.id) === String(id); });
      if (c) editarCategoria(c);
    } else if (action === 'del-cat') {
      eliminarCategoria(id);
    }
  }

  function onEvtTableClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    var evt = findEvento(id);
    if (!evt && action !== 'del-evt') return;
    if (action === 'edit-evt') editarEvento(evt);
    else if (action === 'copy-evt') copiarEvento(evt);
    else if (action === 'del-evt') eliminarEvento(id);
  }

  /* ── boot ── */
  AdminLayout.init({ page: 'videos', title: '🎬 La Tribu' });
  AdminUtils.bindTabs('.sub-tabs');
  AdminUtils.bindModalClose();
  initMesSelect();
  bindEvents();
  window.onAdminTabChange('videos');
})();
