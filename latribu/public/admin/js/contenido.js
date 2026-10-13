(function () {
  let catalog = [];
  let slugActual = '';
  let campos = [];
  let originales = {};
  let estado = {};
  let guardadoJson = '';

  const $ = id => document.getElementById(id);
  const esc = s => AdminApi.escapeHtml(s);
  const clon = v => JSON.parse(JSON.stringify(v));
  const idDe = ruta => 'cf-' + ruta.replace(/\./g, '-');
  const campoDe = clave => campos.find(c => c.clave === clave);

  async function initPage() {
    if (!await AdminLayout.init({ page: 'contenido', title: 'Contenido' })) return;
    const res = await AdminApi.apiFetch('/contenido/admin/catalogo');
    if (!res.ok) return toast('No se pudo cargar la lista de secciones', 'error');
    const data = await res.json();
    catalog = data.slugs || [];
    renderSlugs();
    if (catalog.length) selectSlug(catalog[0].slug);

    $('btn-contenido-guardar').addEventListener('click', guardar);
    $('btn-contenido-restaurar').addEventListener('click', restaurarSeccion);
    $('btn-contenido-aplicar-json').addEventListener('click', aplicarJson);
    $('contenido-avanzado').addEventListener('toggle', () => {
      if ($('contenido-avanzado').open) $('contenido-json').value = JSON.stringify(estado, null, 2);
    });
    const form = $('contenido-form');
    form.addEventListener('input', onInput);
    form.addEventListener('click', onClick);
    form.addEventListener('submit', e => { e.preventDefault(); guardar(); });
  }

  function renderSlugs() {
    const wrap = $('contenido-slugs');
    const groups = {};
    catalog.forEach(s => {
      const g = s.grupo || 'Otro';
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    });
    wrap.innerHTML = Object.keys(groups).map(g =>
      '<div style="margin-bottom:12px"><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">' +
      esc(g) + '</div>' +
      groups[g].map(s =>
        '<button type="button" class="btn btn-outline btn-sm" style="width:100%;justify-content:flex-start;margin-bottom:4px" data-slug="' +
        esc(s.slug) + '">' + esc(s.label) + '</button>'
      ).join('') + '</div>'
    ).join('');
    wrap.querySelectorAll('[data-slug]').forEach(btn => {
      btn.addEventListener('click', () => selectSlug(btn.getAttribute('data-slug')));
    });
  }

  function hayCambios() {
    return slugActual && JSON.stringify(estado) !== guardadoJson;
  }

  async function selectSlug(slug) {
    if (slug !== slugActual && hayCambios() && !confirm('Tienes cambios sin guardar en esta sección. ¿Salir sin guardar?')) return;
    const res = await AdminApi.apiFetch('/contenido/admin/' + encodeURIComponent(slug));
    if (!res.ok) return toast('No se pudo cargar la sección', 'error');
    const data = await res.json();
    slugActual = slug;
    document.querySelectorAll('#contenido-slugs [data-slug]').forEach(b => {
      const activo = b.getAttribute('data-slug') === slug;
      b.classList.toggle('btn-primary', activo);
      b.classList.toggle('btn-outline', !activo);
      if (activo) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const meta = data.meta || catalog.find(c => c.slug === slug) || {};
    $('contenido-slug-title').textContent = meta.label || slug;
    let hint = (meta.donde ? 'Dónde se ve: ' + meta.donde + '. ' : '') + 'Tras guardar, recarga la página pública para ver los cambios.';
    if (slug === 'funnel_empezar') hint += ' Las opciones de objetivos e intereses se editan en Ajustes → Comunidad.';
    if (slug === 'funnel_checkout') hint += ' El precio y los días de prueba se cambian en Ajustes → Suscripciones.';
    $('contenido-slug-hint').textContent = hint;
    campos = data.campos || [];
    originales = data.default || {};
    estado = clon(data.datos || {});
    guardadoJson = JSON.stringify(estado);
    $('contenido-avanzado').open = false;
    mostrarMsg('', true);
    renderForm();
  }

  function renderForm() {
    $('contenido-form').innerHTML = campos.map(c =>
      '<div class="form-group cf-field" id="campo-' + esc(c.clave) + '">' + htmlCampo(c) + '</div>'
    ).join('');
  }

  function renderCampo(clave) {
    $('campo-' + clave).innerHTML = htmlCampo(campoDe(clave));
  }

  function ayudaHtml(c, idAyuda) {
    let h = '<p class="cf-help" id="' + idAyuda + '">' + esc(c.ayuda) + '</p>';
    if (c.saltosDeLinea) h += '<p class="cf-help">Cada salto de línea que escribas se muestra igual en la página.</p>';
    if (c.marcadores && c.marcadores.length) {
      h += '<ul class="cf-marcas" aria-label="Marcadores automáticos">' + c.marcadores.map(m =>
        '<li><code>' + esc(m.marca) + '</code>: ' + esc(m.explicacion) + '. Déjalo tal cual.</li>'
      ).join('') + '</ul>';
    }
    return h;
  }

  function controlTexto(ruta, valor, opts) {
    const attrs = ' id="' + idDe(ruta) + '" data-ruta="' + esc(ruta) + '"' +
      (opts.max ? ' maxlength="' + opts.max + '"' : '') +
      (opts.describe ? ' aria-describedby="' + opts.describe + '"' : '');
    const v = valor == null ? '' : String(valor);
    if (opts.largo) return '<textarea rows="' + (opts.rows || 3) + '"' + attrs + '>' + esc(v) + '</textarea>';
    return '<input type="text"' + attrs + ' value="' + esc(v) + '">';
  }

  function btnRestaurar(c) {
    return '<button type="button" class="btn btn-outline btn-sm" data-restaurar="' + esc(c.clave) +
      '" aria-label="Restaurar texto original de «' + esc(c.etiqueta) + '»">↺ Restaurar texto original</button>';
  }

  function htmlCampo(c) {
    const idAyuda = 'cf-ayuda-' + c.clave;
    const idError = 'cf-error-' + c.clave;
    const describe = idAyuda + ' ' + idError;
    const errorP = '<p class="cf-error" id="' + idError + '" hidden></p>';
    const valor = estado[c.clave];

    if (c.tipo === 'lista' || c.tipo === 'lista_obj') {
      const items = Array.isArray(valor) ? valor : [];
      const fijo = !!c.fijos;
      const n = items.length;
      const botones = i =>
        '<div class="cf-btns">' +
        '<button type="button" class="btn btn-outline btn-sm" data-accion="subir" data-clave="' + esc(c.clave) + '" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir elemento ' + (i + 1) + '">↑</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-accion="bajar" data-clave="' + esc(c.clave) + '" data-i="' + i + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Bajar elemento ' + (i + 1) + '">↓</button>' +
        (fijo ? '' : '<button type="button" class="btn btn-outline btn-sm" data-accion="quitar" data-clave="' + esc(c.clave) + '" data-i="' + i + '" aria-label="Quitar elemento ' + (i + 1) + '">✕ Quitar</button>') +
        '</div>';
      const lis = items.map((it, i) => {
        const ruta = c.clave + '.' + i;
        if (c.tipo === 'lista') {
          return '<li class="cf-row"><div class="cf-grow"><label class="sr-only" for="' + idDe(ruta) + '">' + esc(c.etiqueta) + ', elemento ' + (i + 1) + '</label>' +
            controlTexto(ruta, it, { max: c.max, describe: idAyuda }) + '</div>' + botones(i) + '</li>';
        }
        const obj = it && typeof it === 'object' ? it : {};
        return '<li class="cf-item"><div class="cf-row"><p class="cf-item-title cf-grow" id="' + idDe(ruta) + '" tabindex="-1">Elemento ' + (i + 1) + '</p>' + botones(i) + '</div>' +
          c.subcampos.map(s => {
            const r = ruta + '.' + s.clave;
            const idSub = 'cf-ayuda-' + c.clave + '-' + i + '-' + s.clave;
            return '<div class="cf-sub"><label for="' + idDe(r) + '">' + esc(s.etiqueta) + '</label>' +
              controlTexto(r, obj[s.clave], { max: s.max, largo: s.largo, describe: s.ayuda ? idSub : '' }) +
              (s.ayuda ? '<p class="cf-help" id="' + idSub + '">' + esc(s.ayuda) + '</p>' : '') + '</div>';
          }).join('') + '</li>';
      }).join('');
      return '<fieldset aria-describedby="' + describe + '"><div class="cf-head"><legend>' + esc(c.etiqueta) + '</legend>' + btnRestaurar(c) + '</div>' +
        ayudaHtml(c, idAyuda) + errorP +
        '<ol class="cf-list" style="margin-top:10px">' + lis + '</ol>' +
        (fijo ? '<p class="cf-help">Esta lista tiene siempre ' + c.fijos + ' elementos: puedes cambiar el texto y el orden.</p>'
          : '<button type="button" class="btn btn-outline btn-sm cf-add" data-accion="anadir" data-clave="' + esc(c.clave) + '">+ Añadir elemento</button>') +
        '</fieldset>';
    }

    const id = idDe(c.clave);
    let control;
    if (c.tipo === 'numero') {
      control = '<input type="number" id="' + id + '" data-ruta="' + esc(c.clave) + '" data-numero="1" min="' + c.min + '" max="' + c.max + '" step="1" value="' + esc(valor) + '" aria-describedby="' + describe + '">';
    } else {
      const largo = c.tipo !== 'corto';
      control = controlTexto(c.clave, valor, { max: c.max, largo, rows: c.tipo === 'html' ? 4 : 3, describe });
    }
    const aviso = c.tipo === 'html'
      ? '<p class="cf-aviso"><span aria-hidden="true">⚠ </span><strong>Campo con formato.</strong> Puede llevar etiquetas como <code>&lt;br&gt;</code> (salto de línea), <code>&lt;em&gt;</code> (cursiva) o <code>&lt;strong&gt;</code> (negrita). No borres los signos &lt; &gt; de una etiqueta sin borrar la etiqueta completa.</p>'
      : '';
    return '<div class="form-group" style="margin:0"><div class="cf-head"><label for="' + id + '">' + esc(c.etiqueta) + '</label>' + btnRestaurar(c) + '</div>' +
      aviso + control + ayudaHtml(c, idAyuda) + errorP + '</div>';
  }

  function setRuta(ruta, valor) {
    const partes = ruta.split('.');
    let obj = estado;
    for (let i = 0; i < partes.length - 1; i++) {
      const k = partes[i];
      if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = /^\d+$/.test(partes[i + 1]) ? [] : {};
      obj = obj[k];
    }
    obj[partes[partes.length - 1]] = valor;
  }

  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.ruta) return;
    const v = el.dataset.numero ? (el.value === '' ? '' : Number(el.value)) : el.value;
    setRuta(el.dataset.ruta, v);
    el.removeAttribute('aria-invalid');
  }

  function onClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.restaurar) return restaurarCampo(btn.dataset.restaurar);
    const accion = btn.dataset.accion;
    if (!accion) return;
    const clave = btn.dataset.clave;
    const c = campoDe(clave);
    if (!Array.isArray(estado[clave])) estado[clave] = [];
    const arr = estado[clave];
    const i = Number(btn.dataset.i);
    let foco;
    if (accion === 'anadir') {
      if (arr.length >= c.maxItems) return mostrarMsg('La lista ya tiene el máximo de ' + c.maxItems + ' elementos.', false);
      arr.push(c.tipo === 'lista' ? '' : {});
      foco = c.tipo === 'lista' ? idDe(clave + '.' + (arr.length - 1)) : idDe(clave + '.' + (arr.length - 1) + '.' + c.subcampos[0].clave);
    } else if (accion === 'quitar') {
      const etiqueta = '«' + c.etiqueta + '», elemento ' + (i + 1);
      if (!confirm('¿Quitar ' + etiqueta + '? Podrás recuperarlo con «Restaurar texto original» o saliendo sin guardar.')) return;
      arr.splice(i, 1);
      foco = null;
    } else {
      const j = accion === 'subir' ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      foco = '[data-accion="' + accion + '"][data-clave="' + clave + '"][data-i="' + j + '"]';
    }
    renderCampo(clave);
    const cont = $('campo-' + clave);
    let el = foco ? (foco.startsWith('[') ? cont.querySelector(foco) : $(foco)) : null;
    if (!el || el.disabled) el = cont.querySelector('[data-accion="anadir"]') || cont.querySelector('button');
    if (el) el.focus();
  }

  function restaurarCampo(clave) {
    const c = campoDe(clave);
    if (!c || !(clave in originales)) return;
    if (!confirm('¿Volver al texto original de «' + c.etiqueta + '»? Se perderá lo que escribiste en este campo.')) return;
    estado[clave] = clon(originales[clave]);
    renderCampo(clave);
    const el = $(idDe(clave)) || $('campo-' + clave).querySelector('input,textarea,button');
    if (el) el.focus();
    mostrarMsg('Se puso el texto original en «' + c.etiqueta + '». Pulsa «Guardar cambios» para publicarlo.', true);
  }

  function errorTexto(v, max) {
    if (typeof v !== 'string') return 'debe ser un texto';
    if (!v.trim()) return 'no puede quedar vacío';
    if (v.length > max) return 'es demasiado largo (máximo ' + max + ' caracteres, tiene ' + v.length + ')';
    return null;
  }

  function validarCliente() {
    const errores = [];
    const add = (c, ruta, mensaje) => errores.push({ campo: ruta, etiqueta: c.etiqueta, mensaje });
    campos.forEach(c => {
      const v = estado[c.clave];
      if (c.tipo === 'numero') {
        if (!Number.isInteger(v) || v < c.min || v > c.max) add(c, c.clave, 'debe ser un número entero entre ' + c.min + ' y ' + c.max);
        return;
      }
      if (c.tipo === 'lista' || c.tipo === 'lista_obj') {
        if (!Array.isArray(v)) return add(c, c.clave, 'debe ser una lista');
        if (!v.length) add(c, c.clave, 'la lista no puede quedar vacía');
        if (c.fijos && v.length !== c.fijos) add(c, c.clave, 'debe tener exactamente ' + c.fijos + ' elementos');
        v.forEach((it, i) => {
          if (c.tipo === 'lista') {
            const e = errorTexto(it, c.max);
            if (e) add(c, c.clave + '.' + i, 'elemento ' + (i + 1) + ': ' + e);
            return;
          }
          c.subcampos.forEach(s => {
            const val = it ? it[s.clave] : undefined;
            if (s.opcional && (val === undefined || val === '')) return;
            const e = errorTexto(val, s.max);
            if (e) add(c, c.clave + '.' + i + '.' + s.clave, 'elemento ' + (i + 1) + ', ' + s.etiqueta + ': ' + e);
          });
        });
        return;
      }
      const e = errorTexto(v, c.max);
      if (e) add(c, c.clave, e);
    });
    return errores;
  }

  function limpiarErrores() {
    document.querySelectorAll('#contenido-form [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    document.querySelectorAll('#contenido-form .cf-error').forEach(p => { p.textContent = ''; p.hidden = true; });
  }

  function mostrarErrores(errores, titulo) {
    limpiarErrores();
    let primero = null;
    errores.forEach(err => {
      const clave = String(err.campo || '').split('.')[0];
      const p = $('cf-error-' + clave);
      if (p) {
        p.hidden = false;
        p.textContent = (p.textContent ? p.textContent + ' · ' : '⚠ ') + err.mensaje;
      }
      const el = $(idDe(err.campo || '')) || $(idDe(clave));
      if (el) {
        if (el.matches('input,textarea')) el.setAttribute('aria-invalid', 'true');
        if (!primero) primero = el;
      }
    });
    const box = $('contenido-msg');
    box.className = 'msg-box error';
    box.style.display = 'block';
    box.setAttribute('role', 'alert');
    box.innerHTML = '<strong>⚠ ' + esc(titulo) + '</strong><ul>' + errores.map(err =>
      '<li>' + (err.etiqueta ? '<strong>' + esc(err.etiqueta) + '</strong>: ' : '') + esc(err.mensaje) + '</li>'
    ).join('') + '</ul>';
    if (primero) primero.focus(); else box.focus();
  }

  function mostrarMsg(texto, ok) {
    const box = $('contenido-msg');
    box.setAttribute('role', ok ? 'status' : 'alert');
    AdminUtils.mostrarMsg(box, texto ? (ok ? '✓ ' : '⚠ ') + texto : '', ok);
  }

  function datosParaGuardar() {
    const datos = clon(estado);
    campos.filter(c => c.tipo === 'lista_obj').forEach(c => {
      if (!Array.isArray(datos[c.clave])) return;
      datos[c.clave].forEach(it => {
        if (!it || typeof it !== 'object') return;
        c.subcampos.forEach(s => { if (s.opcional && it[s.clave] === '') delete it[s.clave]; });
      });
    });
    return datos;
  }

  async function guardar() {
    if (!slugActual) return;
    const errores = validarCliente();
    if (errores.length) return mostrarErrores(errores, 'No se guardó. Corrige lo siguiente:');
    const btn = $('btn-contenido-guardar');
    btn.disabled = true;
    try {
      const datos = datosParaGuardar();
      const res = await AdminApi.apiFetch('/contenido/admin/' + encodeURIComponent(slugActual), {
        method: 'PUT',
        body: JSON.stringify({ datos }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* respuesta sin JSON */ }
      if (res.ok) {
        limpiarErrores();
        guardadoJson = JSON.stringify(estado);
        mostrarMsg('Cambios guardados. Recarga la página pública para verlos.', true);
        toast('Contenido actualizado', 'success');
      } else if (Array.isArray(data.errores) && data.errores.length) {
        mostrarErrores(data.errores, 'No se guardó. ' + (data.error || 'Corrige lo siguiente:'));
      } else {
        mostrarMsg('No se pudo guardar: ' + (data.error || 'error del servidor') + '. Lo que escribiste sigue aquí; inténtalo de nuevo.', false);
      }
    } catch {
      mostrarMsg('No se pudo conectar con el servidor. Lo que escribiste sigue aquí; inténtalo de nuevo.', false);
    } finally {
      btn.disabled = false;
    }
  }

  async function restaurarSeccion() {
    if (!slugActual) return;
    const nombre = $('contenido-slug-title').textContent;
    if (!confirm('¿Restaurar TODA la sección «' + nombre + '» al texto original? Se guardará de inmediato y se perderán los cambios de esta sección.')) return;
    try {
      const res = await AdminApi.apiFetch('/contenido/admin/' + encodeURIComponent(slugActual) + '/restaurar', { method: 'POST' });
      if (!res.ok) return mostrarMsg('No se pudo restaurar la sección. Inténtalo de nuevo.', false);
      const data = await res.json();
      estado = clon(data.datos);
      guardadoJson = JSON.stringify(estado);
      renderForm();
      mostrarMsg('Sección restaurada al texto original y guardada.', true);
      toast('Sección restaurada', 'success');
    } catch {
      mostrarMsg('No se pudo conectar con el servidor. Inténtalo de nuevo.', false);
    }
  }

  function aplicarJson() {
    let obj;
    try {
      obj = JSON.parse($('contenido-json').value);
    } catch (e) {
      return mostrarMsg('El JSON no es válido: ' + e.message, false);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return mostrarMsg('El JSON debe ser un objeto { … }.', false);
    campos.forEach(c => { if (!(c.clave in obj)) obj[c.clave] = clon(originales[c.clave]); });
    estado = obj;
    renderForm();
    const desconocidas = Object.keys(obj).filter(k => !campoDe(k));
    mostrarMsg('JSON aplicado al formulario. Revisa y pulsa «Guardar cambios».' +
      (desconocidas.length ? ' Atención: hay campos que no existen en esta sección (' + desconocidas.join(', ') + ') y el servidor los rechazará.' : ''), !desconocidas.length);
  }

  initPage();
})();
