(function () {
  AdminLayout.init({ page: 'encuestas', title: '📊 Encuestas' }).then(function (ok) {
    if (!ok) return;

    var encuestas = [];
    var editId = null;
    var guardando = false;
    var resultadosCache = {};

    var listEl = document.getElementById('enc-list');
    var btnNueva = document.getElementById('btn-nueva');
    var btnGuardar = document.getElementById('btn-guardar-enc');
    var btnAddPregunta = document.getElementById('btn-add-pregunta');
    var preguntasEditor = document.getElementById('preguntas-editor');
    var modalTitle = document.getElementById('modal-enc-title');

    AdminUtils.bindModalClose();
    btnNueva.addEventListener('click', function () { abrirModal(); });
    btnGuardar.addEventListener('click', guardar);
    btnAddPregunta.addEventListener('click', function () { agregarPreguntaEditor(); });

    cargar();

    function publicLink(slug) {
      var base = (window.__APP_BASE__ || '').replace(/\/+$/, '');
      var origin = window.location.origin;
      return origin + (base ? base + '/' : '/') + 'encuesta/' + slug;
    }

    async function cargar() {
      try {
        var res = await AdminApi.apiFetch('/encuestas/admin', { headers: AdminApi.authHeaders() });
        encuestas = await res.json();
        renderLista();
      } catch (e) {
        toast('Error cargando encuestas', 'error');
      }
    }

    function renderLista() {
      if (!encuestas.length) {
        listEl.innerHTML = '<div class="table-empty"><div class="empty-icon">📊</div><div class="empty-text">No hay encuestas. Crea la primera.</div></div>';
        return;
      }

      listEl.innerHTML = encuestas.map(function (e) {
        var badge = e.activa
          ? '<span class="badge badge-activo">Activa</span>'
          : '<span class="badge badge-inactivo">Inactiva</span>';
        return '<div class="enc-item" data-id="' + e.id + '">' +
          '<div class="enc-head" data-toggle="' + e.id + '">' +
            '<div style="flex:1;min-width:0">' +
              '<div class="enc-title">' + AdminApi.escapeHtml(e.titulo) + ' ' + badge + '</div>' +
              '<div class="enc-meta">' +
                e.total_preguntas + ' preguntas · ' + e.total_respuestas + ' respuestas · ' +
                '<code style="font-size:.75rem">' + AdminApi.escapeHtml(e.slug) + '</code>' +
              '</div>' +
            '</div>' +
            '<div class="enc-actions" onclick="event.stopPropagation()">' +
              '<button type="button" class="btn btn-outline btn-xs" data-copy="' + e.id + '">🔗 Copiar link</button>' +
              '<button type="button" class="btn btn-primary btn-xs" data-edit="' + e.id + '">Editar</button>' +
              '<button type="button" class="btn btn-danger btn-xs" data-del="' + e.id + '">Eliminar</button>' +
              '<span class="enc-chevron">▼</span>' +
            '</div>' +
          '</div>' +
          '<div class="enc-results" id="results-' + e.id + '"></div>' +
        '</div>';
      }).join('');

      listEl.querySelectorAll('[data-toggle]').forEach(function (head) {
        head.addEventListener('click', function (ev) {
          if (ev.target.closest('button')) return;
          toggleResultados(parseInt(head.getAttribute('data-toggle'), 10));
        });
      });
      listEl.querySelectorAll('[data-copy]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = parseInt(btn.getAttribute('data-copy'), 10);
          var enc = encuestas.find(function (x) { return x.id === id; });
          if (!enc) return;
          var url = publicLink(enc.slug);
          navigator.clipboard.writeText(url).then(function () {
            toast('Enlace copiado', 'success');
          }).catch(function () {
            prompt('Copia este enlace:', url);
          });
        });
      });
      listEl.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          editar(parseInt(btn.getAttribute('data-edit'), 10));
        });
      });
      listEl.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          eliminar(parseInt(btn.getAttribute('data-del'), 10));
        });
      });
    }

    async function toggleResultados(id) {
      var item = listEl.querySelector('.enc-item[data-id="' + id + '"]');
      if (!item) return;
      var open = item.classList.contains('open');
      listEl.querySelectorAll('.enc-item.open').forEach(function (el) { el.classList.remove('open'); });
      if (open) return;
      item.classList.add('open');
      var box = document.getElementById('results-' + id);
      box.innerHTML = '<div class="enc-results-loading">Cargando resultados…</div>';
      try {
        var data;
        if (resultadosCache[id]) {
          data = resultadosCache[id];
        } else {
          var res = await AdminApi.apiFetch('/encuestas/admin/' + id + '/resultados', { headers: AdminApi.authHeaders() });
          data = await res.json();
          resultadosCache[id] = data;
        }
        renderResultados(box, data);
      } catch (e) {
        box.innerHTML = '<div class="enc-results-loading">Error al cargar resultados</div>';
      }
    }

    function renderResultados(box, data) {
      if (!data.total_respuestas) {
        box.innerHTML = '<div class="res-total">Sin respuestas todavía.</div>';
        return;
      }
      var html = '<div class="res-total"><strong>' + data.total_respuestas + '</strong> respuesta' +
        (data.total_respuestas === 1 ? '' : 's') + ' en total</div>';
      data.preguntas.forEach(function (p, idx) {
        var tipoLabel = p.tipo === 'multiple' ? 'Opción múltiple' : 'Opción única';
        html += '<div class="res-q"><div class="res-q-title">' + (idx + 1) + '. ' +
          AdminApi.escapeHtml(p.texto) + '<span class="res-q-type">' + tipoLabel + '</span></div>';
        var maxCount = Math.max.apply(null, p.opciones.map(function (o) { return o.count; }).concat([1]));
        p.opciones.forEach(function (o) {
          var pct = o.percent || 0;
          var w = Math.round((o.count / maxCount) * 100);
          html += '<div class="bar-row">' +
            '<div class="bar-label" title="' + AdminApi.escapeHtml(o.texto) + '">' + AdminApi.escapeHtml(o.texto) + '</div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
            '<div class="bar-num">' + o.count + ' (' + pct + '%)</div>' +
          '</div>';
        });
        html += '</div>';
      });
      box.innerHTML = html;
    }

    function abrirModal(enc) {
      editId = enc ? enc.id : null;
      modalTitle.textContent = enc ? '📊 Editar encuesta' : '📊 Nueva encuesta';
      document.getElementById('enc-titulo').value = enc ? enc.titulo : '';
      document.getElementById('enc-desc').value = enc ? (enc.descripcion || '') : '';
      document.getElementById('enc-slug').value = enc ? enc.slug : '';
      document.getElementById('enc-activa').value = enc && !enc.activa ? '0' : '1';
      preguntasEditor.innerHTML = '';
      if (enc && enc.preguntas && enc.preguntas.length) {
        enc.preguntas.forEach(function (p) { agregarPreguntaEditor(p); });
      } else {
        agregarPreguntaEditor();
      }
      AdminUtils.showModal('modal-encuesta');
    }

    async function editar(id) {
      try {
        var res = await AdminApi.apiFetch('/encuestas/admin/' + id, { headers: AdminApi.authHeaders() });
        var enc = await res.json();
        abrirModal(enc);
      } catch (e) {
        toast('Error al cargar encuesta', 'error');
      }
    }

    function agregarPreguntaEditor(data) {
      var wrap = document.createElement('div');
      wrap.className = 'q-editor';
      var tipo = data && data.tipo === 'multiple' ? 'multiple' : 'single';
      var oblig = !data || data.obligatoria !== false;
      wrap.innerHTML =
        '<div class="q-editor-head">' +
          '<input type="text" class="q-texto" placeholder="Texto de la pregunta" value="' + AdminApi.escapeHtml(data ? data.texto : '') + '">' +
          '<select class="q-tipo"><option value="single"' + (tipo === 'single' ? ' selected' : '') + '>Una opción</option>' +
          '<option value="multiple"' + (tipo === 'multiple' ? ' selected' : '') + '>Varias opciones</option></select>' +
          '<label style="font-size:.8rem;display:flex;align-items:center;gap:4px"><input type="checkbox" class="q-oblig"' + (oblig ? ' checked' : '') + '> Obligatoria</label>' +
          '<button type="button" class="btn btn-danger btn-xs q-remove">✕</button>' +
        '</div>' +
        '<div class="q-opciones"></div>' +
        '<button type="button" class="btn btn-outline btn-xs q-add-opt">+ Opción</button>';
      preguntasEditor.appendChild(wrap);
      var optsBox = wrap.querySelector('.q-opciones');
      var opciones = data && data.opciones && data.opciones.length
        ? data.opciones.map(function (o) { return o.texto; })
        : ['', ''];
      opciones.forEach(function (t) { agregarOpcionEditor(optsBox, t); });
      wrap.querySelector('.q-remove').addEventListener('click', function () {
        if (preguntasEditor.children.length <= 1) { toast('Mínimo una pregunta', 'error'); return; }
        wrap.remove();
      });
      wrap.querySelector('.q-add-opt').addEventListener('click', function () {
        agregarOpcionEditor(optsBox, '');
      });
    }

    function agregarOpcionEditor(box, texto) {
      var row = document.createElement('div');
      row.className = 'opt-row';
      row.innerHTML =
        '<input type="text" class="opt-texto" placeholder="Opción" value="' + AdminApi.escapeHtml(texto || '') + '">' +
        '<button type="button" class="btn btn-danger btn-xs opt-remove">✕</button>';
      row.querySelector('.opt-remove').addEventListener('click', function () {
        if (box.children.length <= 2) { toast('Mínimo 2 opciones por pregunta', 'error'); return; }
        row.remove();
      });
      box.appendChild(row);
    }

    function leerPreguntasDelEditor() {
      var preguntas = [];
      preguntasEditor.querySelectorAll('.q-editor').forEach(function (wrap) {
        var texto = wrap.querySelector('.q-texto').value.trim();
        if (!texto) return;
        var tipo = wrap.querySelector('.q-tipo').value;
        var obligatoria = wrap.querySelector('.q-oblig').checked;
        var opciones = [];
        wrap.querySelectorAll('.opt-texto').forEach(function (inp) {
          var t = inp.value.trim();
          if (t) opciones.push(t);
        });
        if (opciones.length < 2) return;
        preguntas.push({ texto: texto, tipo: tipo, obligatoria: obligatoria, opciones: opciones });
      });
      return preguntas;
    }

    async function guardar() {
      if (guardando) return;
      var titulo = document.getElementById('enc-titulo').value.trim();
      if (!titulo) { toast('El título es obligatorio', 'error'); return; }
      var preguntas = leerPreguntasDelEditor();
      if (!preguntas.length) {
        toast('Agrega al menos una pregunta con 2 opciones', 'error');
        return;
      }
      var payload = {
        titulo: titulo,
        descripcion: document.getElementById('enc-desc').value.trim(),
        slug: document.getElementById('enc-slug').value.trim(),
        activa: document.getElementById('enc-activa').value === '1',
        preguntas: preguntas,
      };
      guardando = true;
      btnGuardar.disabled = true;
      try {
        var url = editId ? '/encuestas/admin/' + editId : '/encuestas/admin';
        var method = editId ? 'PUT' : 'POST';
        var res = await AdminApi.apiFetch(url, {
          method: method,
          headers: AdminApi.authHeaders(),
          body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        toast(editId ? 'Encuesta actualizada' : 'Encuesta creada', 'success');
        AdminUtils.hideModal('modal-encuesta');
        delete resultadosCache[editId];
        await cargar();
        if (!editId && data.slug) {
          var urlPublic = publicLink(data.slug);
          if (confirm('Encuesta creada. ¿Copiar enlace para compartir?\n\n' + urlPublic)) {
            navigator.clipboard.writeText(urlPublic).catch(function () {});
          }
        }
      } catch (e) {
        toast(e.message || 'Error al guardar', 'error');
      } finally {
        guardando = false;
        btnGuardar.disabled = false;
      }
    }

    async function eliminar(id) {
      var enc = encuestas.find(function (x) { return x.id === id; });
      if (!enc) return;
      if (!confirm('¿Eliminar la encuesta "' + enc.titulo + '" y todas sus respuestas?')) return;
      try {
        var res = await AdminApi.apiFetch('/encuestas/admin/' + id, {
          method: 'DELETE',
          headers: AdminApi.authHeaders(),
        });
        if (!res.ok) {
          var d = await res.json();
          throw new Error(d.error || 'Error');
        }
        delete resultadosCache[id];
        toast('Encuesta eliminada', 'success');
        cargar();
      } catch (e) {
        toast(e.message || 'Error al eliminar', 'error');
      }
    }
  });
})();
