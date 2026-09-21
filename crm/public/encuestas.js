(function () {
  const BASE = window.__APP_BASE__ || '';
  let encuestas = [], editId = null, guardando = false, resultadosCache = {};

  const listEl    = document.getElementById('encListContainer');
  const modal     = document.getElementById('encModal');
  const modalTitle = document.getElementById('encModalTitle');
  const btnNueva  = document.getElementById('btnNuevaEncuesta');
  const btnGuardar = document.getElementById('btnGuardarEnc');
  const btnAdd    = document.getElementById('btnAddPregunta');
  const editor    = document.getElementById('preguntasEditor');

  document.getElementById('encModalClose').addEventListener('click', cerrarModal);
  document.getElementById('encModalCancel').addEventListener('click', cerrarModal);
  btnNueva.addEventListener('click', () => abrirModal());
  btnGuardar.addEventListener('click', guardar);
  btnAdd.addEventListener('click', () => agregarPreguntaEditor());
  document.getElementById('btnCopyLink').addEventListener('click', () => {
    const url = document.getElementById('encLinkPreview').value;
    if (url) navigator.clipboard.writeText(url).then(() => CRM.toast('Enlace copiado', 'success')).catch(() => prompt('Copia:', url));
  });

  cargar();

  function publicLink(slug) {
    return window.location.origin + BASE + '/encuesta/' + slug;
  }

  async function cargar() {
    try {
      const res = await fetch(BASE + '/api/encuestas/admin', { credentials: 'same-origin' });
      encuestas = await res.json();
      renderLista();
    } catch { CRM.toast('Error cargando encuestas', 'error'); }
  }

  function renderLista() {
    if (!encuestas.length) {
      listEl.innerHTML = '<div class="empty-state"><i class="fas fa-poll"></i><p>No hay encuestas. Crea la primera.</p></div>';
      return;
    }
    listEl.innerHTML = encuestas.map(e => `
      <div class="enc-item" data-id="${e.id}">
        <div class="enc-head" data-toggle="${e.id}">
          <div class="enc-info">
            <div class="enc-title">${escHtml(e.titulo)}
              <span class="badge ${e.activa ? 'badge-green' : 'badge-red'}">${e.activa ? 'Activa' : 'Inactiva'}</span>
            </div>
            <div class="enc-meta">${e.total_preguntas} preguntas · ${e.total_respuestas} respuestas · <code>${escHtml(e.slug)}</code></div>
          </div>
          <div class="enc-actions" onclick="event.stopPropagation()">
            <button class="btn btn-outline btn-sm" data-copy="${e.id}"><i class="fas fa-link"></i> Link</button>
            <button class="btn btn-primary btn-sm" data-edit="${e.id}"><i class="fas fa-pen"></i></button>
            <button class="btn btn-danger btn-sm" data-del="${e.id}"><i class="fas fa-trash"></i></button>
            <i class="fas fa-chevron-down enc-chevron"></i>
          </div>
        </div>
        <div class="enc-results" id="results-${e.id}" style="display:none"></div>
      </div>`).join('');

    listEl.querySelectorAll('[data-toggle]').forEach(h => {
      h.addEventListener('click', e => { if (!e.target.closest('button')) toggleResultados(parseInt(h.dataset.toggle)); });
    });
    listEl.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const enc = encuestas.find(x => x.id === parseInt(btn.dataset.copy));
        if (enc) navigator.clipboard.writeText(publicLink(enc.slug)).then(() => CRM.toast('Enlace copiado', 'success')).catch(() => {});
      });
    });
    listEl.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => editar(parseInt(btn.dataset.edit))));
    listEl.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => eliminar(parseInt(btn.dataset.del))));
  }

  async function toggleResultados(id) {
    const item = listEl.querySelector(`.enc-item[data-id="${id}"]`);
    if (!item) return;
    const box = document.getElementById('results-' + id);
    const open = item.classList.contains('open');
    listEl.querySelectorAll('.enc-item.open').forEach(el => {
      el.classList.remove('open');
      document.getElementById('results-' + el.dataset.id).style.display = 'none';
    });
    if (open) return;
    item.classList.add('open');
    box.style.display = 'block';
    box.innerHTML = '<div class="enc-loading"><i class="fas fa-spinner fa-spin"></i> Cargando resultados…</div>';
    try {
      const data = resultadosCache[id] || await (await fetch(BASE + '/api/encuestas/admin/' + id + '/resultados', { credentials: 'same-origin' })).json();
      resultadosCache[id] = data;
      renderResultados(box, data);
    } catch { box.innerHTML = '<div class="enc-loading">Error al cargar resultados</div>'; }
  }

  function renderResultados(box, data) {
    if (!data.total_respuestas) { box.innerHTML = '<div class="enc-loading">Sin respuestas todavía.</div>'; return; }
    let html = `<div class="res-total"><strong>${data.total_respuestas}</strong> respuesta${data.total_respuestas === 1 ? '' : 's'}</div>`;
    data.preguntas.forEach((p, i) => {
      const tipoLabel = p.tipo === 'multiple' ? 'Múltiple' : p.tipo === 'text' ? 'Texto libre' : 'Única';
      html += `<div class="res-q"><div class="res-q-title">${i + 1}. ${escHtml(p.texto)} <span class="res-q-type">${tipoLabel}</span></div>`;
      if (p.tipo === 'text') {
        const textos = p.respuestas_texto || [];
        html += textos.length
          ? '<div class="res-text-list">' + textos.map(r => `<div class="res-text-item">${escHtml(r.texto)}</div>`).join('') + '</div>'
          : '<div class="res-text-empty">Sin respuestas de texto.</div>';
      } else {
        const maxC = Math.max(...p.opciones.map(o => o.count), 1);
        p.opciones.forEach(o => {
          const w = Math.round((o.count / maxC) * 100);
          html += `<div class="bar-row">
            <div class="bar-label" title="${escHtml(o.texto)}">${escHtml(o.texto)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
            <div class="bar-num">${o.count} (${o.percent}%)</div>
          </div>`;
        });
      }
      html += '</div>';
    });
    box.innerHTML = html;
  }

  function abrirModal(enc) {
    editId = enc ? enc.id : null;
    modalTitle.textContent = enc ? 'Editar encuesta' : 'Nueva encuesta';
    document.getElementById('encTitulo').value = enc ? enc.titulo : '';
    document.getElementById('encDesc').value = enc ? (enc.descripcion || '') : '';
    document.getElementById('encActiva').value = enc && !enc.activa ? '0' : '1';
    const linkGroup = document.getElementById('encLinkGroup');
    const linkHint  = document.getElementById('encLinkHint');
    if (enc && enc.slug) {
      linkGroup.style.display = '';
      linkHint.style.display = 'none';
      document.getElementById('encLinkPreview').value = publicLink(enc.slug);
    } else {
      linkGroup.style.display = 'none';
      linkHint.style.display = '';
    }
    editor.innerHTML = '';
    if (enc && enc.preguntas && enc.preguntas.length) enc.preguntas.forEach(p => agregarPreguntaEditor(p));
    else agregarPreguntaEditor();
    modal.style.display = 'flex';
  }

  function cerrarModal() { modal.style.display = 'none'; }

  async function editar(id) {
    try {
      const enc = await (await fetch(BASE + '/api/encuestas/admin/' + id, { credentials: 'same-origin' })).json();
      abrirModal(enc);
    } catch { CRM.toast('Error al cargar encuesta', 'error'); }
  }

  function agregarPreguntaEditor(data) {
    const wrap = document.createElement('div');
    wrap.className = 'q-editor';
    const tipo = data && ['multiple', 'text'].includes(data.tipo) ? data.tipo : 'single';
    const oblig = !data || data.obligatoria !== false;
    wrap.innerHTML = `
      <div class="q-editor-head">
        <input type="text" class="form-control q-texto" placeholder="Texto de la pregunta" value="${escHtml(data ? data.texto : '')}">
        <select class="form-select q-tipo" style="max-width:160px">
          <option value="single"${tipo === 'single' ? ' selected' : ''}>Una opción</option>
          <option value="multiple"${tipo === 'multiple' ? ' selected' : ''}>Varias opciones</option>
          <option value="text"${tipo === 'text' ? ' selected' : ''}>Texto libre</option>
        </select>
        <label class="q-oblig-label"><input type="checkbox" class="q-oblig"${oblig ? ' checked' : ''}> Obligatoria</label>
        <button type="button" class="btn btn-danger btn-sm q-remove"><i class="fas fa-times"></i></button>
      </div>
      <div class="q-opciones"></div>
      <button type="button" class="btn btn-outline btn-sm q-add-opt"><i class="fas fa-plus"></i> Opción</button>`;
    editor.appendChild(wrap);
    const optsBox = wrap.querySelector('.q-opciones');
    const addOptBtn = wrap.querySelector('.q-add-opt');
    const tipoSelect = wrap.querySelector('.q-tipo');
    const opciones = data && data.opciones && data.opciones.length ? data.opciones.map(o => o.texto) : ['', ''];
    opciones.forEach(t => agregarOpcionEditor(optsBox, t));
    function toggleOpts() { const isText = tipoSelect.value === 'text'; optsBox.style.display = isText ? 'none' : ''; addOptBtn.style.display = isText ? 'none' : ''; }
    tipoSelect.addEventListener('change', toggleOpts);
    toggleOpts();
    wrap.querySelector('.q-remove').addEventListener('click', () => {
      if (editor.children.length <= 1) { CRM.toast('Mínimo una pregunta', 'error'); return; }
      wrap.remove();
    });
    addOptBtn.addEventListener('click', () => agregarOpcionEditor(optsBox, ''));
  }

  function agregarOpcionEditor(box, texto) {
    const row = document.createElement('div');
    row.className = 'opt-row';
    row.innerHTML = `<input type="text" class="form-control opt-texto" placeholder="Opción" value="${escHtml(texto || '')}">
      <button type="button" class="btn btn-danger btn-sm opt-remove"><i class="fas fa-times"></i></button>`;
    row.querySelector('.opt-remove').addEventListener('click', () => {
      if (box.children.length <= 2) { CRM.toast('Mínimo 2 opciones', 'error'); return; }
      row.remove();
    });
    box.appendChild(row);
  }

  function leerPreguntas() {
    const preguntas = [];
    editor.querySelectorAll('.q-editor').forEach(wrap => {
      const texto = wrap.querySelector('.q-texto').value.trim();
      if (!texto) return;
      const tipo = wrap.querySelector('.q-tipo').value;
      const obligatoria = wrap.querySelector('.q-oblig').checked;
      const opciones = [...wrap.querySelectorAll('.opt-texto')].map(i => i.value.trim()).filter(Boolean);
      if (tipo !== 'text' && opciones.length < 2) return;
      preguntas.push({ texto, tipo, obligatoria, opciones: tipo === 'text' ? [] : opciones });
    });
    return preguntas;
  }

  async function guardar() {
    if (guardando) return;
    const titulo = document.getElementById('encTitulo').value.trim();
    if (!titulo) { CRM.toast('El título es obligatorio', 'error'); return; }
    const preguntas = leerPreguntas();
    if (!preguntas.length) { CRM.toast('Agrega al menos una pregunta válida', 'error'); return; }
    const payload = {
      titulo,
      descripcion: document.getElementById('encDesc').value.trim(),
      activa: document.getElementById('encActiva').value === '1',
      preguntas,
    };
    guardando = true;
    btnGuardar.disabled = true;
    try {
      const url = editId ? BASE + '/api/encuestas/admin/' + editId : BASE + '/api/encuestas/admin';
      const res = await fetch(url, {
        method: editId ? 'PUT' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');
      CRM.toast(editId ? 'Encuesta actualizada' : 'Encuesta creada', 'success');
      cerrarModal();
      delete resultadosCache[editId];
      if (!editId && data.slug) {
        const url = publicLink(data.slug);
        if (confirm('Encuesta creada. ¿Copiar enlace?\n\n' + url)) navigator.clipboard.writeText(url).catch(() => {});
      }
      await cargar();
    } catch (e) { CRM.toast(e.message || 'Error al guardar', 'error'); }
    finally { guardando = false; btnGuardar.disabled = false; }
  }

  async function eliminar(id) {
    const enc = encuestas.find(x => x.id === id);
    if (!enc || !confirm(`¿Eliminar "${enc.titulo}" y todas sus respuestas?`)) return;
    try {
      const res = await fetch(BASE + '/api/encuestas/admin/' + id, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json()).error || 'Error');
      delete resultadosCache[id];
      CRM.toast('Encuesta eliminada', 'success');
      cargar();
    } catch (e) { CRM.toast(e.message || 'Error al eliminar', 'error'); }
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
