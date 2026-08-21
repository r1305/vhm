/* VHM CRM — calendario.js */
(function () {
  'use strict';

  const { api, toast, esc, openModal, ESTADO_CITA, fullName } = window.CRM;

  const DIAS_CORTO  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const DIAS_LARGO  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let vista           = 'mes';
  let cursor          = new Date();
  cursor.setHours(0,0,0,0);
  let citasCache      = [];
  let bloqueosCache   = [];
  let terapeutasCache = [];
  let terapeutaColorMap = {};
  let colorIdx = 0;

  function colorForTer(tid) {
    const key = String(tid);
    if (!terapeutaColorMap[key]) terapeutaColorMap[key] = `cal-color-${colorIdx++ % 8}`;
    return terapeutaColorMap[key];
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function startOfWeek(d) {
    const r = new Date(d);
    r.setDate(d.getDate() - d.getDay());
    r.setHours(0,0,0,0);
    return r;
  }

  function rangoActual() {
    if (vista === 'mes') {
      const desde = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const hasta = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
      return { desde, hasta };
    }
    if (vista === 'semana') {
      const desde = startOfWeek(cursor);
      const hasta = new Date(desde); hasta.setDate(desde.getDate()+6);
      return { desde, hasta };
    }
    return { desde: new Date(cursor), hasta: new Date(cursor) };
  }

  /* ── Expandir bloqueos multi-día a mapa por fecha ── */
  function toIsoDateStr(v) {
    return String(v).slice(0, 10);
  }

  function bloqueosPorFechaMap() {
    const map = {};
    bloqueosCache.forEach(b => {
      let d = new Date(toIsoDateStr(b.fecha_inicio) + 'T12:00:00');
      const fin = new Date(toIsoDateStr(b.fecha_fin) + 'T12:00:00');
      while (d <= fin) {
        const f = isoDate(d);
        if (!map[f]) map[f] = [];
        map[f].push(b);
        d.setDate(d.getDate()+1);
      }
    });
    return map;
  }

  /* ── Cargar citas y bloqueos ── */
  async function loadCitas() {
    try {
      const { desde, hasta } = rangoActual();
      const desdeStr = isoDate(desde);
      const hastaStr = isoDate(hasta);

      const qs = new URLSearchParams();
      if (vista === 'dia') {
        qs.set('fecha', desdeStr);
      } else {
        qs.set('mes', `${desde.getFullYear()}-${String(desde.getMonth()+1).padStart(2,'0')}`);
      }
      const tid = document.getElementById('calTerapeuta')?.value;
      if (tid) qs.set('terapeuta_id', tid);
      else if (window.__USER_ROL__ === 'terapeuta') qs.set('terapeuta_id', window.__USER_ID__);

      const qsB = new URLSearchParams({ desde: desdeStr, hasta: hastaStr });
      if (tid) qsB.set('terapeuta_id', tid);
      else if (window.__USER_ROL__ === 'terapeuta') qsB.set('terapeuta_id', window.__USER_ID__);

      [citasCache, bloqueosCache] = await Promise.all([
        api(`/citas?${qs}`),
        api(`/bloqueos?${qsB}`),
      ]);

      if (vista === 'semana' && desde.getMonth() !== hasta.getMonth()) {
        const qs2 = new URLSearchParams(qs);
        qs2.set('mes', `${hasta.getFullYear()}-${String(hasta.getMonth()+1).padStart(2,'0')}`);
        const extra = await api(`/citas?${qs2}`);
        const ids = new Set(citasCache.map(c => c.id));
        extra.forEach(c => { if (!ids.has(c.id)) citasCache.push(c); });
      }

      render();
    } catch (err) { toast(err.message, 'danger'); }
  }

  /* ── Título ── */
  function actualizarTitulo() {
    const el = document.getElementById('calTitulo');
    if (!el) return;
    if (vista === 'mes') {
      el.textContent = `${MESES_LARGO[cursor.getMonth()]} ${cursor.getFullYear()}`;
    } else if (vista === 'semana') {
      const ini = startOfWeek(cursor);
      const fin = new Date(ini); fin.setDate(ini.getDate()+6);
      el.textContent = `${ini.getDate()} ${MESES_LARGO[ini.getMonth()].slice(0,3)} — ${fin.getDate()} ${MESES_LARGO[fin.getMonth()].slice(0,3)} ${fin.getFullYear()}`;
    } else {
      el.textContent = `${DIAS_LARGO[cursor.getDay()]} ${cursor.getDate()} de ${MESES_LARGO[cursor.getMonth()]} ${cursor.getFullYear()}`;
    }
  }

  /* ── Render principal ── */
  function render() {
    actualizarTitulo();
    const grid = document.getElementById('calGrid');
    if (vista === 'mes')    grid.innerHTML = renderMes();
    if (vista === 'semana') grid.innerHTML = `<div class="cal-semana-wrap">${renderSemana(7)}</div>`;
    if (vista === 'dia')    grid.innerHTML = renderDia();
    bindEventos();
    renderLeyenda();
  }

  /* ── Leyenda ── */
  function renderLeyenda() {
    const el = document.getElementById('calLeyenda');
    if (!el) return;
    const selTer = document.getElementById('calTerapeuta');
    if (!selTer || selTer.value) { el.innerHTML = ''; return; }
    const vistos = new Map();
    citasCache.forEach(c => { if (!vistos.has(c.terapeuta_id)) vistos.set(c.terapeuta_id, c.terapeuta_nombre || ''); });
    if (!vistos.size) { el.innerHTML = ''; return; }
    el.innerHTML = [...vistos.entries()].map(([tid, nombre]) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px">
        <span style="width:12px;height:12px;border-radius:3px;flex-shrink:0" class="${colorForTer(tid)}"></span>
        ${esc(nombre)}
      </span>`
    ).join('');
  }

  /* ── Vista Mes ── */
  function renderMes() {
    const hoy  = new Date(); hoy.setHours(0,0,0,0);
    const anio = cursor.getFullYear();
    const mes  = cursor.getMonth();
    const ini  = new Date(anio, mes, 1);
    const fin  = new Date(anio, mes+1, 0);

    const porFecha = {};
    citasCache.forEach(c => {
      const f = String(c.fecha).slice(0,10);
      if (!porFecha[f]) porFecha[f] = [];
      porFecha[f].push(c);
    });
    const bMap = bloqueosPorFechaMap();

    let html = `<table class="cal-mes"><thead><tr>`;
    DIAS_CORTO.forEach(d => { html += `<th>${d}</th>`; });
    html += `</tr></thead><tbody>`;

    let dia = new Date(anio, mes, 1 - ini.getDay());
    while (dia <= fin || dia.getDay() !== 0) {
      if (dia.getDay() === 0) html += '<tr>';
      const esMes = dia.getMonth() === mes;
      const esHoy = dia.getTime() === hoy.getTime();
      const fStr  = isoDate(dia);
      const citas = porFecha[fStr] || [];
      const bloqs = bMap[fStr] || [];
      const MAX   = 3;
      let shown   = 0;

      html += `<td class="${esHoy?'cal-hoy':''} ${!esMes?'cal-otro-mes':''} ${bloqs.length?'cal-dia-bloqueado':''}" data-fecha="${fStr}">`;
      html += `<span class="cal-dia-num">${dia.getDate()}</span>`;
      bloqs.forEach(b => {
        if (shown >= MAX) return;
        html += `<div class="cal-bloqueo" data-bloqueo="${b.id}" title="${esc(b.titulo)}">🔒 ${esc(b.titulo)}</div>`;
        shown++;
      });
      citas.slice(0, MAX - shown).forEach(c => {
        html += `<div class="cal-evento ${colorForTer(c.terapeuta_id)}" data-cita="${c.id}">
          ${esc((c.paciente_nombre||'').split(' ')[0])} ${esc((c.paciente_apellido||'').split(' ')[0])}
        </div>`;
        shown++;
      });
      const resto = (citas.length + bloqs.length) - shown;
      if (resto > 0) html += `<div class="cal-mas" data-fecha="${fStr}">+${resto} más</div>`;
      html += `</td>`;
      if (dia.getDay() === 6) html += '</tr>';
      dia.setDate(dia.getDate()+1);
    }
    html += `</tbody></table>`;
    return html;
  }

  /* ── Vista Semana ── */
  function renderSemana(dias) {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const ini = startOfWeek(cursor);
    const cols = [];
    for (let i = 0; i < dias; i++) {
      const d = new Date(ini); d.setDate(ini.getDate()+i); cols.push(d);
    }
    const porFecha = {};
    citasCache.forEach(c => { const f=String(c.fecha).slice(0,10); if(!porFecha[f]) porFecha[f]=[]; porFecha[f].push(c); });
    const bMap = bloqueosPorFechaMap();

    let html = `<table class="cal-semana"><thead><tr><th class="cal-time-col"></th>`;
    cols.forEach(d => {
      const esHoy = d.getTime()===hoy.getTime();
      html += `<th class="${esHoy?'cal-hoy-col':''}">
        <div style="font-size:11px">${DIAS_CORTO[d.getDay()]}</div>
        <div style="font-size:16px;font-weight:700;${esHoy?'color:var(--primary)':''}">${d.getDate()}</div>
      </th>`;
    });
    html += `</tr></thead><tbody><tr><td class="cal-time-col" style="font-size:10px;padding-top:6px">citas</td>`;
    cols.forEach(d => {
      const fStr=isoDate(d), citas=porFecha[fStr]||[], bloqs=bMap[fStr]||[], esHoy=d.getTime()===hoy.getTime();
      html += `<td class="${esHoy?'cal-hoy-col':''} ${bloqs.length?'cal-dia-bloqueado':''}" data-fecha="${fStr}" style="padding:4px;min-height:50px">`;
      bloqs.forEach(b => { html += `<div class="cal-bloqueo" data-bloqueo="${b.id}" style="margin-bottom:3px">🔒 ${esc(b.titulo)}<span style="opacity:.7;font-size:10px"> · ${esc(b.terapeuta_nombre||'')}</span></div>`; });
      citas.forEach(c => { html += `<div class="cal-evento ${colorForTer(c.terapeuta_id)}" data-cita="${c.id}" style="margin-bottom:3px">${esc((c.paciente_nombre||'').split(' ')[0])} ${esc((c.paciente_apellido||'').split(' ')[0])}<span style="opacity:.8;font-size:10px"> · ${esc(c.terapeuta_nombre||'')}</span></div>`; });
      if (!citas.length && !bloqs.length) html += `<div style="height:30px"></div>`;
      html += `</td>`;
    });
    html += `</tr></tbody></table>`;
    return html;
  }

  /* ── Vista Día con 24 slots ── */
  function renderDia() {
    const fStr  = isoDate(cursor);
    const citas = citasCache.filter(c => String(c.fecha).slice(0,10) === fStr);
    const bMap  = bloqueosPorFechaMap();
    const bloqs = bMap[fStr] || [];

    function toMin(t) {
      if (!t) return null;
      const parts = String(t).split(':');
      return parseInt(parts[0],10)*60 + parseInt(parts[1]||0,10);
    }

    let html = `<div class="cal-dia-grid">`;
    for (let h = 0; h < 24; h++) {
      const slotMin = h * 60;
      const slotMax = slotMin + 60;
      const label   = `${String(h).padStart(2,'0')}:00`;

      const citasSlot = citas.filter(c => {
        const ini = toMin(c.hora_inicio);
        const fin = toMin(c.hora_fin);
        if (ini === null) return false;
        return ini < slotMax && (fin !== null ? fin > slotMin : ini >= slotMin);
      });

      const bloqsSlot = bloqs.filter(b => {
        const ini = toMin(b.hora_inicio);
        const fin = toMin(b.hora_fin);
        if (ini === null || fin === null) return true; // todo el día
        return ini < slotMax && fin > slotMin;
      });

      html += `<div class="cal-dia-row">
        <div class="cal-dia-hora">${label}</div>
        <div class="cal-dia-cell${bloqsSlot.length?' cal-dia-bloqueado':''}" data-fecha="${fStr}">`;

      bloqsSlot.forEach(b => {
        html += `<div class="cal-bloqueo" data-bloqueo="${b.id}">🔒 ${esc(b.titulo)}<span style="opacity:.7;font-size:10px"> · ${esc(b.terapeuta_nombre||'')}</span></div>`;
      });
      citasSlot.forEach(c => {
        const hi = String(c.hora_inicio||'').slice(0,5);
        const hf = String(c.hora_fin||'').slice(0,5);
        html += `<div class="cal-evento ${colorForTer(c.terapeuta_id)}" data-cita="${c.id}">
          <strong>${hi}${hf?' – '+hf:''}</strong>
          ${esc((c.paciente_nombre||'')+' '+(c.paciente_apellido||''))}
          <span style="opacity:.8;font-size:10px"> · ${esc(c.terapeuta_nombre||'')}</span>
        </div>`;
      });

      html += `</div></div>`;
    }
    html += `</div>`;
    return html;
  }

  /* ── Bind clicks ── */
  function bindEventos() {
    document.querySelectorAll('[data-cita]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const cita = citasCache.find(c => String(c.id) === el.dataset.cita);
        if (cita) showDetalle(cita);
      });
    });

    document.querySelectorAll('[data-bloqueo]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const b = bloqueosCache.find(x => String(x.id) === el.dataset.bloqueo);
        if (b) showDetalleBloqueo(b);
      });
    });

    document.querySelectorAll('[data-fecha]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-cita]') || e.target.closest('[data-bloqueo]') || e.target.closest('.cal-mas')) return;
        const bMap = bloqueosPorFechaMap();
        const bloqsDelDia = bMap[el.dataset.fecha] || [];
        if (bloqsDelDia.length) { showDetalleBloqueo(bloqsDelDia[0]); return; }
        showNuevoBloqueo(el.dataset.fecha).catch(err => toast(err.message, 'danger'));
      });
    });

    document.querySelectorAll('.cal-mas').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const [y,m,d] = el.dataset.fecha.split('-').map(Number);
        cursor = new Date(y, m-1, d);
        setVista('dia');
      });
    });
  }

  /* ── Modal nuevo bloqueo ── */
  async function showNuevoBloqueo(fecha) {
    const esAdmin = window.__USER_ROL__ !== 'terapeuta';
    if (esAdmin && !terapeutasCache.length) {
      try { terapeutasCache = await api('/terapeutas'); }
      catch (e) { toast('No se pudieron cargar los terapeutas', 'danger'); return; }
    }
    const terOpts = terapeutasCache.map(t =>
      `<option value="${t.id}">${esc(fullName(t))}</option>`
    ).join('');

    openModal('Bloquear fecha', `
      ${esAdmin ? `<div class="form-group">
        <label class="form-label">Terapeuta *</label>
        <select class="form-select" id="f_bloqueo_ter">
          <option value="">— Seleccionar —</option>${terOpts}
        </select>
      </div>` : ''}
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Desde *</label>
          <input type="date" class="form-control" id="f_bloqueo_desde" value="${fecha}">
        </div>
        <div class="form-group">
          <label class="form-label">Hasta *</label>
          <input type="date" class="form-control" id="f_bloqueo_hasta" value="${fecha}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Hora inicio</label>
          <input type="time" class="form-control" id="f_bloqueo_hi" value="00:00">
        </div>
        <div class="form-group">
          <label class="form-label">Hora fin</label>
          <input type="time" class="form-control" id="f_bloqueo_hf" value="23:59">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Motivo</label>
        <input class="form-control" id="f_bloqueo_titulo" placeholder="Vacaciones, feriado…" value="Bloqueado">
      </div>`, async () => {
      const desde  = document.getElementById('f_bloqueo_desde').value;
      const hasta  = document.getElementById('f_bloqueo_hasta').value;
      const titulo = document.getElementById('f_bloqueo_titulo').value.trim() || 'Bloqueado';
      if (!desde || !hasta) throw new Error('Las fechas son obligatorias');
      if (hasta < desde)    throw new Error('La fecha hasta debe ser igual o posterior al desde');
      const body = { fecha_inicio: desde, fecha_fin: hasta, titulo,
        hora_inicio: document.getElementById('f_bloqueo_hi').value || '00:00',
        hora_fin:    document.getElementById('f_bloqueo_hf').value || '23:59',
      };
      if (esAdmin) {
        const tid = document.getElementById('f_bloqueo_ter').value;
        if (!tid) throw new Error('Selecciona un terapeuta');
        body.terapeuta_id = tid;
      }
      await api('/bloqueos', { method: 'POST', body });
      const [y,m,d] = desde.split('-').map(Number);
      cursor = new Date(y, m-1, d);
      cursor.setHours(0,0,0,0);
      toast('Bloqueo creado');
      loadCitas();
    });
  }

  /* ── Detalle bloqueo ── */
  function showDetalleBloqueo(b) {
    const puedeBorrar = window.__USER_ROL__ !== 'terapeuta' || String(b.terapeuta_id) === String(window.__USER_ID__);
    openModal('Bloqueo de agenda', `
      <div style="font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><span style="color:var(--text-muted)">Terapeuta</span><br><strong>${esc((b.terapeuta_nombre||'') + ' ' + (b.terapeuta_apellido||''))}</strong></div>
        <div><span style="color:var(--text-muted)">Motivo</span><br><strong>${esc(b.titulo)}</strong></div>
        <div><span style="color:var(--text-muted)">Desde</span><br><strong>${b.fecha_inicio}</strong></div>
        <div><span style="color:var(--text-muted)">Hasta</span><br><strong>${b.fecha_fin}</strong></div>
      </div>
      ${puedeBorrar ? `<div style="margin-top:16px">
        <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" id="btnEliminarBloqueo">
          <i class="fas fa-trash"></i> Eliminar bloqueo
        </button>
      </div>` : ''}`, null);
    document.getElementById('modalSave').style.display = 'none';
    document.getElementById('btnEliminarBloqueo')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este bloqueo?')) return;
      try {
        await api(`/bloqueos/${b.id}`, { method: 'DELETE' });
        toast('Bloqueo eliminado');
        document.getElementById('modalOverlay').classList.remove('open');
        loadCitas();
      } catch (e) { toast(e.message, 'danger'); }
    });
  }

  /* ── Detalle cita ── */
  function showDetalle(c) {
    const estado = (ESTADO_CITA[c.estado] || { label: c.estado, css: 'badge-gray' });
    openModal('Detalle de cita', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
        <div><span style="color:var(--text-muted)">Paciente</span><br><strong>${esc((c.paciente_nombre||'')+' '+(c.paciente_apellido||''))}</strong></div>
        <div><span style="color:var(--text-muted)">Terapeuta</span><br><strong>${esc(c.terapeuta_nombre||'—')}</strong></div>
        <div><span style="color:var(--text-muted)">Fecha</span><br><strong>${String(c.fecha).slice(0,10)}</strong></div>
        <div><span style="color:var(--text-muted)">Modalidad</span><br><strong>${esc(c.modalidad||'—')}</strong></div>
        <div><span style="color:var(--text-muted)">Tipo</span><br><strong>${esc(c.tipo||'—')}</strong></div>
        <div><span style="color:var(--text-muted)">Estado</span><br><span class="badge ${estado.css}">${estado.label}</span></div>
      </div>
      ${c.notas ? `<div style="margin-top:12px"><span style="color:var(--text-muted);font-size:12px">Observaciones</span><p style="margin-top:4px;font-size:13px">${esc(c.notas)}</p></div>` : ''}
    `, null);
    document.getElementById('modalSave').style.display = 'none';
  }

  /* ── Cambiar vista ── */
  function setVista(v) {
    vista = v;
    document.querySelectorAll('.cal-vista-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === v));
    loadCitas();
  }

  /* ── Navegación ── */
  function navegar(dir) {
    if (vista === 'mes')    cursor.setMonth(cursor.getMonth() + dir);
    else if (vista === 'semana') cursor.setDate(cursor.getDate() + dir * 7);
    else cursor.setDate(cursor.getDate() + dir);
    loadCitas();
  }

  /* ── Listeners ── */
  document.getElementById('calPrev').addEventListener('click', () => navegar(-1));
  document.getElementById('calNext').addEventListener('click', () => navegar(1));
  document.getElementById('calHoy').addEventListener('click', () => { cursor = new Date(); cursor.setHours(0,0,0,0); loadCitas(); });
  document.querySelectorAll('.cal-vista-btn').forEach(btn =>
    btn.addEventListener('click', () => setVista(btn.dataset.vista))
  );
  document.getElementById('calTerapeuta')?.addEventListener('change', loadCitas);

  /* ── Init: cargar terapeutas para el modal de bloqueo ── */
  api('/terapeutas').then(ts => { terapeutasCache = ts; }).catch(() => {});
  loadCitas();

})();
