/* VHM CRM — calendario.js */
(function () {
  'use strict';

  const { api, toast, esc, openModal, ESTADO_CITA, fullName } = window.CRM;

  const DIAS_CORTO  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const DIAS_LARGO  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let vista      = 'mes';
  let cursor     = new Date();
  cursor.setHours(0,0,0,0);
  let citasCache = [];
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
    r.setDate(d.getDate() - d.getDay()); // domingo
    r.setHours(0,0,0,0);
    return r;
  }

  /* ── Rango de fechas según vista ── */
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
    // dia
    return { desde: new Date(cursor), hasta: new Date(cursor) };
  }

  /* ── Cargar citas del rango ── */
  async function loadCitas() {
    try {
      const { desde, hasta } = rangoActual();
      const qs = new URLSearchParams();
      // Para mes/semana usamos rango; la API acepta mes o fecha
      if (vista === 'dia') {
        qs.set('fecha', isoDate(desde));
      } else {
        // Pedimos mes a mes si el rango cruza meses
        qs.set('mes', `${desde.getFullYear()}-${String(desde.getMonth()+1).padStart(2,'0')}`);
      }
      const tid = document.getElementById('calTerapeuta')?.value;
      if (tid) qs.set('terapeuta_id', tid);
      else if (window.__USER_ROL__ === 'terapeuta') qs.set('terapeuta_id', window.__USER_ID__);

      citasCache = await api(`/citas?${qs}`);

      // Si vista semana y cruza mes, pedir también el mes siguiente
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

  /* ── Título del toolbar ── */
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
    if (vista === 'dia')    grid.innerHTML = `<div class="cal-semana-wrap">${renderSemana(1)}</div>`;
    bindEventos();
    renderLeyenda();
  }

  /* ── Leyenda de terapeutas ── */
  function renderLeyenda() {
    const el = document.getElementById('calLeyenda');
    if (!el) return;
    // Solo visible para admin (el select de terapeuta existe y no tiene valor fijo)
    const selTer = document.getElementById('calTerapeuta');
    if (!selTer || selTer.value) { el.innerHTML = ''; return; }

    // Terapeutas presentes en las citas actuales
    const vistos = new Map(); // tid -> nombre
    citasCache.forEach(c => {
      if (!vistos.has(c.terapeuta_id)) vistos.set(c.terapeuta_id, c.terapeuta_nombre || '');
    });
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
    const hoy   = new Date(); hoy.setHours(0,0,0,0);
    const anio  = cursor.getFullYear();
    const mes   = cursor.getMonth();
    const ini   = new Date(anio, mes, 1);
    const fin   = new Date(anio, mes+1, 0);

    // Agrupar citas por fecha
    const porFecha = {};
    citasCache.forEach(c => {
      const f = String(c.fecha).slice(0,10);
      if (!porFecha[f]) porFecha[f] = [];
      porFecha[f].push(c);
    });

    let html = `<table class="cal-mes"><thead><tr>`;
    DIAS_CORTO.forEach(d => { html += `<th>${d}</th>`; });
    html += `</tr></thead><tbody>`;

    // Primer día de la semana del mes
    let dia = new Date(anio, mes, 1 - ini.getDay());

    while (dia <= fin || dia.getDay() !== 0) {
      if (dia.getDay() === 0) html += '<tr>';
      const esMes  = dia.getMonth() === mes;
      const esHoy  = dia.getTime() === hoy.getTime();
      const fStr   = isoDate(dia);
      const citas  = porFecha[fStr] || [];
      const MAX    = 3;

      html += `<td class="${esHoy?'cal-hoy':''} ${!esMes?'cal-otro-mes':''}" data-fecha="${fStr}">`;
      html += `<span class="cal-dia-num">${dia.getDate()}</span>`;
      citas.slice(0, MAX).forEach(c => {
        html += `<div class="cal-evento ${colorForTer(c.terapeuta_id)}" data-cita="${c.id}" title="${esc(c.paciente_nombre||'')} ${esc(c.paciente_apellido||'')}">
          ${esc((c.paciente_nombre||'').split(' ')[0])} ${esc((c.paciente_apellido||'').split(' ')[0])}
        </div>`;
      });
      if (citas.length > MAX) html += `<div class="cal-mas" data-fecha="${fStr}">+${citas.length - MAX} más</div>`;
      html += `</td>`;

      if (dia.getDay() === 6) html += '</tr>';
      dia.setDate(dia.getDate()+1);
    }

    html += `</tbody></table>`;
    return html;
  }

  /* ── Vista Semana / Día ── */
  function renderSemana(dias) {
    const hoy  = new Date(); hoy.setHours(0,0,0,0);
    const ini  = dias === 7 ? startOfWeek(cursor) : new Date(cursor);

    // Columnas de fechas
    const cols = [];
    for (let i = 0; i < dias; i++) {
      const d = new Date(ini); d.setDate(ini.getDate()+i);
      cols.push(d);
    }

    // Agrupar citas por fecha
    const porFecha = {};
    citasCache.forEach(c => {
      const f = String(c.fecha).slice(0,10);
      if (!porFecha[f]) porFecha[f] = [];
      porFecha[f].push(c);
    });

    let html = `<table class="cal-semana"><thead><tr><th class="cal-time-col"></th>`;
    cols.forEach(d => {
      const esHoy = d.getTime() === hoy.getTime();
      html += `<th class="${esHoy?'cal-hoy-col':''}">
        <div style="font-size:11px">${DIAS_CORTO[d.getDay()]}</div>
        <div style="font-size:${dias===1?'22px':'16px'};font-weight:700;${esHoy?'color:var(--primary)':''}">${d.getDate()}</div>
      </th>`;
    });
    html += `</tr></thead><tbody>`;

    // Fila "Todo el día" con las citas (sin hora)
    html += `<tr><td class="cal-time-col" style="font-size:10px;padding-top:6px">citas</td>`;
    cols.forEach(d => {
      const fStr = isoDate(d);
      const citas = porFecha[fStr] || [];
      const esHoy = d.getTime() === hoy.getTime();
      html += `<td class="${esHoy?'cal-hoy-col':''}" data-fecha="${fStr}" style="padding:4px;min-height:50px">`;
      citas.forEach(c => {
        html += `<div class="cal-evento ${colorForTer(c.terapeuta_id)}" data-cita="${c.id}" style="margin-bottom:3px">
          ${esc((c.paciente_nombre||'').split(' ')[0])} ${esc((c.paciente_apellido||'').split(' ')[0])}
          <span style="opacity:.8;font-size:10px"> · ${esc(c.terapeuta_nombre||'')}</span>
        </div>`;
      });
      if (!citas.length) html += `<div style="height:30px"></div>`;
      html += `</td>`;
    });
    html += `</tr></tbody></table>`;
    return html;
  }

  /* ── Bind clicks ── */
  function bindEventos() {
    // Click en evento → detalle
    document.querySelectorAll('[data-cita]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const cita = citasCache.find(c => String(c.id) === el.dataset.cita);
        if (cita) showDetalle(cita);
      });
    });

    // Click en celda vacía → ir a vista día
    document.querySelectorAll('[data-fecha]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-cita]')) return;
        const [y,m,d] = el.dataset.fecha.split('-').map(Number);
        cursor = new Date(y, m-1, d);
        setVista('dia');
      });
    });

    // "+N más"
    document.querySelectorAll('.cal-mas').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const [y,m,d] = el.dataset.fecha.split('-').map(Number);
        cursor = new Date(y, m-1, d);
        setVista('dia');
      });
    });
  }

  /* ── Detalle de cita ── */
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
    if (vista === 'mes') {
      cursor.setMonth(cursor.getMonth() + dir);
    } else if (vista === 'semana') {
      cursor.setDate(cursor.getDate() + dir * 7);
    } else {
      cursor.setDate(cursor.getDate() + dir);
    }
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

  /* ── Init ── */
  loadCitas();

})();
