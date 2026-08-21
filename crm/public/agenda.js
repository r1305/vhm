/* ═══════════════════════════════════════════════════════
   VHM CRM — agenda.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, openModal, badge, ESTADO_CITA, fullName } = window.CRM;

  let terapeutaId        = document.getElementById('agendaTerapeuta')?.value || '';
  let pacientesCache     = [];
  let citasCounts        = {};
  let pacienteSeleccionado = null;

  const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS_CORTO = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const TIPO_CITA = { primera_vez:'Primera consulta', seguimiento:'Tratamiento', evaluacion:'Seguimiento', urgencia:'Urgencia' };
  const MODALIDAD_ICON  = { presencial:'fa-building', videollamada:'fa-video', telefono:'fa-phone' };
  const MODALIDAD_LABEL = { presencial:'Presencial', videollamada:'Videollamada', telefono:'Teléfono' };

  function parseFechaParts(fecha) {
    if (!fecha) return { day:'—', dow:'' };
    const [y,m,d] = fecha.slice(0,10).split('-').map(Number);
    const dt = new Date(y,m-1,d);
    return { day: String(d).padStart(2,'0'), dow: DIAS_CORTO[dt.getDay()] };
  }

  function citaCardHTML(c) {
    const { day, dow } = parseFechaParts(c.fecha);
    const modIcon  = MODALIDAD_ICON[c.modalidad]  || 'fa-circle';
    const modLabel = MODALIDAD_LABEL[c.modalidad] || c.modalidad;
    const hora = c.hora_inicio ? String(c.hora_inicio).slice(0,5) : '';
    return `
      <div class="ag-cita-card" data-id="${c.id}">
        <div class="ag-cita-date">
          <div class="ag-cita-day">${day}</div>
          <div class="ag-cita-dow">${dow}</div>
          ${hora ? `<div style="font-size:11px;color:var(--text-muted)">${hora}</div>` : ''}
        </div>
        <div class="ag-cita-body">
          <div class="ag-cita-tipo">${esc(TIPO_CITA[c.tipo]||c.tipo)}</div>
          <div class="ag-cita-meta">
            <span><i class="fas fa-user-md"></i> ${esc(c.terapeuta_nombre||'—')}</span>
            <span><i class="fas ${modIcon}"></i> ${esc(modLabel)}</span>
          </div>
        </div>
        <div class="ag-cita-right">
          ${badge(c.estado, ESTADO_CITA)}
          <div class="ag-cita-actions">
            <button class="btn-icon" data-cita-estado="${c.id}" data-actual="${c.estado}" data-notas="${esc(c.notas||'')}" data-fecha="${c.fecha?c.fecha.slice(0,10):''}" title="Cambiar estado"><i class="fas fa-pen"></i></button>
            <button class="btn-icon" data-send-rec="${c.id}" title="Enviar recordatorio"><i class="fas fa-bell"></i></button>
            ${c.estado!=='realizada'?`<button class="btn-icon" style="color:var(--success)" data-confirmar="${c.id}" title="Marcar realizada"><i class="fas fa-circle-check"></i></button>`:''}
            ${c.estado!=='realizada'&&c.estado!=='cancelada'?`<button class="btn-icon" style="color:var(--danger)" data-cancelar="${c.id}" title="Cancelar"><i class="fas fa-circle-xmark"></i></button>`:''}
            ${(c.estado==='pendiente'||window.__USER_ROL__!=='terapeuta')?`<button class="btn-icon" style="color:var(--danger)" data-eliminar="${c.id}" title="Eliminar cita"><i class="fas fa-trash"></i></button>`:''}
          </div>
        </div>
      </div>`;
  }

  function setAgMobileView(showDetail) {
    document.querySelector('.ag-layout')?.classList.toggle('ag-show-detail', !!showDetail);
  }

  function showDetailEmpty() {
    setAgMobileView(false);
    document.getElementById('agDetail').innerHTML = `
      <div class="ag-detail-empty">
        <i class="fas fa-calendar-days"></i>
        <span>Selecciona un paciente</span>
      </div>`;
  }

  function bindCitaActions(container) {
    container.querySelectorAll('[data-cita-estado]').forEach(btn =>
      btn.addEventListener('click', () => showCambioEstado(btn.dataset.citaEstado, btn.dataset.actual, btn.dataset.notas, btn.dataset.fecha))
    );
    container.querySelectorAll('[data-send-rec]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try { await api(`/citas/${btn.dataset.sendRec}/recordatorio`, { method:'POST' }); toast('Recordatorio enviado'); }
        catch (e) { toast(e.message,'danger'); }
      })
    );
    container.querySelectorAll('[data-confirmar]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          await api(`/citas/${btn.dataset.confirmar}/estado`, { method:'PATCH', body:{ estado:'realizada' } });
          toast('Sesión marcada como realizada'); refreshAgenda();
        } catch (e) { toast(e.message,'danger'); }
      })
    );
    container.querySelectorAll('[data-cancelar]').forEach(btn =>
      btn.addEventListener('click', () => {
        openModal('Cancelar sesión', `
          <div class="form-group">
            <label class="form-label">Motivo *</label>
            <textarea class="form-control" id="f_motivo_cancelacion" rows="3" placeholder="Indica el motivo…"></textarea>
          </div>`, async () => {
          const motivo = document.getElementById('f_motivo_cancelacion').value.trim();
          if (!motivo) throw new Error('Debes ingresar un motivo');
          await api(`/citas/${btn.dataset.cancelar}/estado`, { method:'PATCH', body:{ estado:'cancelada', notas:motivo } });
          toast('Sesión cancelada'); refreshAgenda();
        });
      })
    );
    container.querySelectorAll('[data-eliminar]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta cita?')) return;
        try {
          await api(`/citas/${btn.dataset.eliminar}`, { method:'DELETE' });
          toast('Cita eliminada'); refreshAgenda();
        } catch (e) { toast(e.message,'danger'); }
      })
    );
  }

  function renderPacList() {
    const list = document.getElementById('agPacList');
    const q = document.getElementById('agendaSearch')?.value.trim().toLowerCase() || '';
    const filtered = q
      ? pacientesCache.filter(p =>
          fullName(p).toLowerCase().includes(q) ||
          (p.telefono||'').includes(q) ||
          (p.email||'').toLowerCase().includes(q))
      : pacientesCache;

    if (!filtered.length) { list.innerHTML = '<div class="list-empty">Sin pacientes</div>'; return; }

    list.innerHTML = filtered.map(p => {
      const count   = citasCounts[String(p.id)] || 0;
      const inicial = (p.nombre?.[0]||'?').toUpperCase();
      const sub     = p.telefono || p.terapeuta_nombre || '';
      const active  = String(p.id) === String(pacienteSeleccionado) ? ' active' : '';
      return `
        <div class="ag-pac-item${active}" data-id="${p.id}">
          <div class="ag-pac-avatar">${inicial}</div>
          <div class="ag-pac-info">
            <div class="ag-pac-name">${esc(fullName(p))}</div>
            ${sub ? `<div class="ag-pac-sub">${esc(sub)}</div>` : ''}
          </div>
          ${count ? `<span class="ag-pac-badge">${count}</span>` : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.ag-pac-item').forEach(item =>
      item.addEventListener('click', () => selectPaciente(item.dataset.id))
    );
  }

  function selectPaciente(id) {
    pacienteSeleccionado = id || null;
    document.querySelectorAll('.ag-pac-item').forEach(el =>
      el.classList.toggle('active', el.dataset.id === String(id))
    );
    const sel = document.getElementById('agendaPaciente');
    if (sel) sel.value = id || '';
    if (id) { setAgMobileView(true); loadDetail(id); }
    else showDetailEmpty();
  }

  async function loadDetail(pacienteId) {
    const detail = document.getElementById('agDetail');
    const p = pacientesCache.find(x => String(x.id) === String(pacienteId));
    if (!p) { showDetailEmpty(); return; }
    detail.innerHTML = '<div class="view-loading">Cargando citas…</div>';
    try {
      const citas = await api(`/citas?paciente_id=${pacienteId}`);
      const total      = citas.length;
      const realizadas = citas.filter(c => c.estado==='realizada').length;
      const pendientes = citas.filter(c => ['pendiente','confirmada','reagendada'].includes(c.estado)).length;
      const inicial    = (p.nombre?.[0]||'?').toUpperCase();
      const metaParts  = [p.telefono, p.email, p.terapeuta_nombre].filter(Boolean);
      const porMes = {}, ordenMes = [];
      citas.forEach(c => {
        const mesKey = c.fecha ? c.fecha.slice(0,7) : 'sin-fecha';
        if (!porMes[mesKey]) { porMes[mesKey] = []; ordenMes.push(mesKey); }
        porMes[mesKey].push(c);
      });
      const timelineHTML = total
        ? `<div class="ag-timeline">${ordenMes.map(mesKey => {
            const [anio,mes] = mesKey.split('-');
            const labelMes = mesKey==='sin-fecha' ? 'Sin fecha' : `${MESES_ES[parseInt(mes,10)-1]} ${anio}`;
            return `<div class="ag-mes-bloque"><div class="ag-mes-label">${labelMes}</div>${porMes[mesKey].map(citaCardHTML).join('')}</div>`;
          }).join('')}</div>`
        : '<div class="list-empty" style="padding:40px 20px">Sin citas registradas</div>';
      detail.innerHTML = `
        <div class="ag-detail-header">
          <button type="button" class="btn btn-outline btn-sm ag-back-btn" id="agBackBtn"><i class="fas fa-arrow-left"></i></button>
          <div class="ag-detail-avatar">${inicial}</div>
          <div>
            <div class="ag-detail-name">${esc(fullName(p))}</div>
            ${metaParts.length ? `<div class="ag-detail-meta">${metaParts.map(v=>esc(v)).join(' · ')}</div>` : ''}
          </div>
          <div class="ag-detail-stats">
            <div class="ag-stat"><div class="ag-stat-val">${total}</div><div class="ag-stat-lbl">Total</div></div>
            <div class="ag-stat"><div class="ag-stat-val">${realizadas}</div><div class="ag-stat-lbl">Realizadas</div></div>
            <div class="ag-stat"><div class="ag-stat-val">${pendientes}</div><div class="ag-stat-lbl">Pendientes</div></div>
          </div>
        </div>
        ${timelineHTML}`;
      bindCitaActions(detail);
      document.getElementById('agBackBtn')?.addEventListener('click', () => selectPaciente(null));
    } catch (err) { detail.innerHTML = `<div class="list-empty">${esc(err.message)}</div>`; }
  }

  async function loadSidebar() {
    const list = document.getElementById('agPacList');
    list.innerHTML = '<div class="ag-list-loading"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
    try {
      const qs = new URLSearchParams();
      const tid = document.getElementById('agendaTerapeuta')?.value;
      if (tid) qs.set('terapeuta_id', tid);
      const [pacientes, citas] = await Promise.all([api(`/pacientes?${qs}`), api('/citas')]);
      pacientesCache = pacientes;
      window.CRM.pacientesCache = pacientes;
      citasCounts = {};
      citas.forEach(c => { const k=String(c.paciente_id); citasCounts[k]=(citasCounts[k]||0)+1; });
      const sel = document.getElementById('agendaPaciente');
      if (sel) {
        sel.innerHTML = `<option value="">Todos los pacientes</option>` +
          pacientes.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('');
      }
      if (pacienteSeleccionado && !pacientes.some(p => String(p.id)===String(pacienteSeleccionado))) {
        pacienteSeleccionado = null; showDetailEmpty();
      }
      renderPacList();
      if (pacienteSeleccionado) { if (sel) sel.value = pacienteSeleccionado; await loadDetail(pacienteSeleccionado); }
    } catch (err) { list.innerHTML = `<div class="list-empty">${esc(err.message)}</div>`; }
  }

  async function refreshAgenda() { await loadSidebar(); }

  /* ── Carga masiva ──────────────────────────────────── */
  function showCargaMasiva() {
    const tipoOpts = [['primera_vez','Primera consulta'],['seguimiento','Tratamiento'],['evaluacion','Seguimiento'],['urgencia','Urgencia']]
      .map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
    const estadoOpts = Object.entries(ESTADO_CITA)
      .map(([k,v]) => `<option value="${k}" ${k==='realizada'?'selected':''}>${v.label}</option>`).join('');
    const modalidadOpts = [['presencial','Presencial'],['videollamada','Videollamada','selected'],['telefono','Teléfono']]
      .map(([v,l,s]) => `<option value="${v}" ${s||''}>${l}</option>`).join('');

    let terapeutasCache = [];

    function filaHTML(vals = {}) {
      const tid = vals.terapeuta_id || document.getElementById('agendaTerapeuta')?.value || '';
      const terOpts = terapeutasCache.map(t =>
        `<option value="${t.id}" ${String(t.id)===String(tid)?'selected':''}>${esc(fullName(t))}</option>`
      ).join('');
      const hi = vals.hora_inicio || '17:00';
      const hf = vals.hora_fin    || '18:00';
      return `<tr>
        <td style="padding:3px 4px;position:relative">
          <input class="form-control form-control-sm cm-pac-search" autocomplete="off" placeholder="Buscar…" value="${esc(vals.paciente_nombre||'')}" style="min-width:160px">
          <input type="hidden" class="cm-paciente" value="${vals.paciente_id||''}">
          <div class="cm-pac-drop autocomplete-dropdown" style="display:none;position:absolute;z-index:999;min-width:200px"></div>
        </td>
        <td style="padding:3px 4px"><select class="form-select form-select-sm cm-terapeuta" style="min-width:130px"><option value="">— Terapeuta —</option>${terOpts}</select></td>
        <td style="padding:3px 4px"><input type="date" class="form-control form-control-sm cm-fecha" value="${vals.fecha||''}" style="min-width:130px"></td>
        <td style="padding:3px 4px"><input type="time" class="form-control form-control-sm cm-hora-ini" value="${hi}" style="min-width:90px"></td>
        <td style="padding:3px 4px"><input type="time" class="form-control form-control-sm cm-hora-fin" value="${hf}" style="min-width:90px"></td>
        <td style="padding:3px 4px"><select class="form-select form-select-sm cm-modalidad" style="min-width:110px">${modalidadOpts}</select></td>
        <td style="padding:3px 4px"><select class="form-select form-select-sm cm-tipo" style="min-width:130px">${tipoOpts}</select></td>
        <td style="padding:3px 4px"><select class="form-select form-select-sm cm-estado" style="min-width:110px">${estadoOpts}</select></td>
        <td style="padding:3px 4px"><input type="text" class="form-control form-control-sm cm-notas" value="${esc(vals.notas||'')}" placeholder="Observaciones" style="min-width:140px"></td>
        <td style="padding:3px 4px;white-space:nowrap">
          <button type="button" class="btn-icon cm-clone" title="Clonar fila" style="color:var(--primary)"><i class="fas fa-copy"></i></button>
          <button type="button" class="btn-icon danger cm-del" title="Eliminar fila"><i class="fas fa-times"></i></button>
        </td>
      </tr>`;
    }

    function actualizarContador() {
      const n = document.querySelectorAll('#cmBody tr').length;
      const el = document.getElementById('cmContador');
      if (el) el.textContent = `${n} fila${n!==1?'s':''}`;
    }

    function getFilaVals(tr) {
      return {
        paciente_id: tr.querySelector('.cm-paciente').value,
        paciente_nombre: tr.querySelector('.cm-pac-search').value,
        terapeuta_id: tr.querySelector('.cm-terapeuta').value,
        fecha: tr.querySelector('.cm-fecha').value,
        hora_inicio: tr.querySelector('.cm-hora-ini').value,
        hora_fin: tr.querySelector('.cm-hora-fin').value,
        modalidad: tr.querySelector('.cm-modalidad').value,
        tipo: tr.querySelector('.cm-tipo').value,
        estado: tr.querySelector('.cm-estado').value,
        notas: tr.querySelector('.cm-notas').value,
      };
    }

    function autoFillHoraFin(tr) {
      const ini = tr.querySelector('.cm-hora-ini');
      const fin = tr.querySelector('.cm-hora-fin');
      ini.addEventListener('change', () => {
        if (!ini.value) return;
        const [h,m] = ini.value.split(':').map(Number);
        const d = new Date(2000,0,1,h,m);
        d.setHours(d.getHours()+1);
        fin.value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      });
    }

    function bindFila(tr) {
      tr.querySelector('.cm-del').onclick = () => { tr.remove(); actualizarContador(); };
      tr.querySelector('.cm-clone').onclick = () => {
        const vals = getFilaVals(tr);
        const tmp = document.createElement('tbody');
        tmp.innerHTML = filaHTML(vals);
        const nueva = tmp.firstElementChild;
        tr.after(nueva);
        nueva.querySelector('.cm-modalidad').value = vals.modalidad;
        nueva.querySelector('.cm-tipo').value      = vals.tipo;
        nueva.querySelector('.cm-estado').value    = vals.estado;
        bindFila(nueva); bindPacSearch(nueva); autoFillHoraFin(nueva); actualizarContador();
      };
    }

    function bindPacSearch(tr) {
      const input  = tr.querySelector('.cm-pac-search');
      const hidden = tr.querySelector('.cm-paciente');
      const drop   = tr.querySelector('.cm-pac-drop');
      input.addEventListener('input', () => {
        hidden.value = '';
        const q = input.value.trim().toLowerCase();
        if (!q) { drop.style.display='none'; return; }
        const tidFila = tr.querySelector('.cm-terapeuta').value;
        const pool = tidFila ? pacientesCache.filter(p => String(p.terapeuta_id)===String(tidFila)) : pacientesCache;
        const matches = pool.filter(p => fullName(p).toLowerCase().includes(q)||(p.telefono||'').includes(q)).slice(0,8);
        if (!matches.length) { drop.style.display='none'; return; }
        drop.innerHTML = matches.map(p =>
          `<div class="autocomplete-item" data-pid="${p.id}" data-tid="${p.terapeuta_id||''}" data-name="${esc(fullName(p))}">
            <strong>${esc(fullName(p))}</strong>
            ${p.terapeuta_nombre?`<span style="color:var(--text-muted)"> — ${esc(p.terapeuta_nombre)}</span>`:''}
          </div>`
        ).join('');
        drop.style.display = 'block';
        drop.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('mousedown', e => {
            e.preventDefault();
            hidden.value = item.dataset.pid;
            input.value  = item.dataset.name;
            drop.style.display = 'none';
            if (item.dataset.tid) tr.querySelector('.cm-terapeuta').value = item.dataset.tid;
          });
        });
      });
      input.addEventListener('blur', () => setTimeout(() => { drop.style.display='none'; }, 150));
    }

    openModal('Carga masiva de citas', `
      <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
        <button type="button" class="btn btn-outline btn-sm" id="cmAgregarFila"><i class="fas fa-plus"></i> Agregar fila</button>
        <span id="cmContador" style="font-size:12px;color:var(--text-muted)">1 fila</span>
      </div>
      <div style="overflow-x:auto;min-height:320px;max-height:60vh;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead style="position:sticky;top:0;background:var(--card-bg);z-index:1">
            <tr style="color:var(--text-muted);border-bottom:2px solid var(--border)">
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Paciente *</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Terapeuta *</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Fecha *</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">H. Inicio</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">H. Fin</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Modalidad</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Tipo</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Estado</th>
              <th style="padding:6px 8px;text-align:left;white-space:nowrap">Observaciones</th>
              <th style="width:56px"></th>
            </tr>
          </thead>
          <tbody id="cmBody"></tbody>
        </table>
      </div>`, async () => {
      const filas = [...document.querySelectorAll('#cmBody tr')];
      if (!filas.length) throw new Error('Agrega al menos una fila');
      const citas = [];
      for (const [i, fila] of filas.entries()) {
        const paciente_id  = fila.querySelector('.cm-paciente').value;
        const terapeuta_id = fila.querySelector('.cm-terapeuta').value;
        const fecha        = fila.querySelector('.cm-fecha').value;
        if (!paciente_id || !terapeuta_id || !fecha)
          throw new Error(`Fila ${i+1}: paciente, terapeuta y fecha son obligatorios`);
        citas.push({
          paciente_id, terapeuta_id, fecha,
          hora_inicio: fila.querySelector('.cm-hora-ini').value || '17:00',
          hora_fin:    fila.querySelector('.cm-hora-fin').value || '18:00',
          modalidad:   fila.querySelector('.cm-modalidad').value,
          tipo:        fila.querySelector('.cm-tipo').value,
          estado:      fila.querySelector('.cm-estado').value,
          notas:       fila.querySelector('.cm-notas').value,
        });
      }
      const resultados = await Promise.allSettled(citas.map(c => api('/citas', { method:'POST', body:c })));
      const ok      = resultados.filter(r => r.status==='fulfilled').length;
      const errores = resultados.filter(r => r.status==='rejected').length;
      toast(`${ok} cita${ok!==1?'s':''} creada${ok!==1?'s':''}${errores?` · ${errores} error${errores!==1?'es':''}`:''}`  , errores?'info':'success');
      refreshAgenda();
    }, { large: true });

    setTimeout(() => { const m=document.getElementById('modal'); if(m) m.style.maxWidth='95vw'; }, 0);

    if (!pacientesCache.length) {
      const tid = document.getElementById('agendaTerapeuta')?.value || '';
      const qs = new URLSearchParams();
      if (tid) qs.set('terapeuta_id', tid);
      api(`/pacientes?${qs}`).then(ps => { pacientesCache = ps; }).catch(() => {});
    }

    api('/terapeutas').then(ts => {
      terapeutasCache = ts;
      const tbody = document.getElementById('cmBody');
      if (!tbody) return;
      const tmp = document.createElement('tbody');
      tmp.innerHTML = filaHTML();
      const fila = tmp.firstElementChild;
      tbody.appendChild(fila);
      bindFila(fila); bindPacSearch(fila); autoFillHoraFin(fila); actualizarContador();
    }).catch(() => {});

    document.getElementById('cmAgregarFila')?.addEventListener('click', () => {
      const tbody = document.getElementById('cmBody');
      const tmp = document.createElement('tbody');
      tmp.innerHTML = filaHTML();
      const fila = tmp.firstElementChild;
      tbody.appendChild(fila);
      bindFila(fila); bindPacSearch(fila); autoFillHoraFin(fila); actualizarContador();
    });
  }

  /* ── Cambio de estado ───────────────────────────────── */
  function showCambioEstado(id, actual, notasActual='', fechaActual='') {
    const esAdmin = window.__USER_ROL__ !== 'terapeuta';
    const fechaISO = fechaActual ? fechaActual.slice(0,10) : '';
    openModal('Editar cita', `
      ${esAdmin ? `<div class="form-group">
        <label class="form-label">Fecha</label>
        <input type="date" class="form-control" id="f_fecha_cita" value="${esc(fechaISO)}">
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Estado</label>
        <select class="form-select" id="f_estado_cita">
          ${Object.entries(ESTADO_CITA).map(([k,v]) => `<option value="${k}" ${k===actual?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones *</label>
        <textarea class="form-control" id="f_notas_cita" rows="3">${esc(notasActual)}</textarea>
      </div>`, async () => {
      const notas = document.getElementById('f_notas_cita').value.trim();
      if (!notas) throw new Error('Las observaciones son obligatorias');
      const body = { estado: document.getElementById('f_estado_cita').value, notas };
      if (esAdmin) {
        const fecha = document.getElementById('f_fecha_cita')?.value;
        if (!fecha) throw new Error('La fecha es obligatoria');
        body.fecha = fecha;
      }
      await api(`/citas/${id}/estado`, { method:'PATCH', body });
      toast('Cita actualizada'); refreshAgenda();
    });
  }

  /* ── Nueva cita ─────────────────────────────────────── */
  function showNuevaCita() {
    const hoy = new Date();
    const fechaISO = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
    const esTerapeuta = window.__USER_ROL__ === 'terapeuta';
    openModal('Nueva cita', `
      <div class="form-group" style="position:relative">
        <label class="form-label">Paciente *</label>
        <input class="form-control" id="f_paciente_search" autocomplete="off" placeholder="Buscar paciente…">
        <input type="hidden" id="f_paciente_id">
        <div id="f_paciente_dropdown" class="autocomplete-dropdown" style="display:none"></div>
      </div>
      <div class="form-row">
        ${!esTerapeuta ? `<div class="form-group">
          <label class="form-label">Terapeuta *</label>
          <select class="form-select" id="f_terapeuta_id"></select>
        </div>` : `<input type="hidden" id="f_terapeuta_id" value="${window.__USER_ID__}">`}
        <div class="form-group">
          <label class="form-label">Fecha *</label>
          <input type="date" class="form-control" id="f_fecha" value="${fechaISO}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Hora inicio</label>
          <input type="time" class="form-control" id="f_hora_inicio" value="17:00">
        </div>
        <div class="form-group">
          <label class="form-label">Hora fin</label>
          <input type="time" class="form-control" id="f_hora_fin" value="18:00">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Modalidad</label>
          <select class="form-select" id="f_modalidad">
            <option value="presencial">Presencial</option>
            <option value="videollamada" selected>Videollamada</option>
            <option value="telefono">Teléfono</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <select class="form-select" id="f_tipo">
            <option value="primera_vez">Primera consulta</option>
            <option value="seguimiento" selected>Tratamiento</option>
            <option value="evaluacion">Seguimiento</option>
            <option value="urgencia">Urgencia</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-select" id="f_estado">
            ${Object.entries(ESTADO_CITA).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones${esTerapeuta?' *':''}</label>
        <textarea class="form-control" id="f_notas" rows="2"></textarea>
      </div>`, async () => {
      const notas = document.getElementById('f_notas').value.trim();
      if (esTerapeuta && !notas) throw new Error('Las observaciones son obligatorias');
      const body = {
        paciente_id:  document.getElementById('f_paciente_id').value,
        terapeuta_id: document.getElementById('f_terapeuta_id').value,
        fecha:        document.getElementById('f_fecha').value,
        hora_inicio:  document.getElementById('f_hora_inicio').value || '17:00',
        hora_fin:     document.getElementById('f_hora_fin').value   || '18:00',
        modalidad:    document.getElementById('f_modalidad').value,
        tipo:         document.getElementById('f_tipo').value,
        estado:       document.getElementById('f_estado').value,
        notas,
      };
      if (!body.paciente_id || !body.terapeuta_id || !body.fecha)
        throw new Error('Completa todos los campos requeridos');
      await api('/citas', { method:'POST', body });
      toast('Cita creada');
      pacienteSeleccionado = body.paciente_id;
      refreshAgenda();
    });

    // Auto-fill hora fin +1h
    setTimeout(() => {
      const hi = document.getElementById('f_hora_inicio');
      const hf = document.getElementById('f_hora_fin');
      if (hi && hf) hi.addEventListener('change', () => {
        if (!hi.value) return;
        const [h,m] = hi.value.split(':').map(Number);
        const d = new Date(2000,0,1,h,m); d.setHours(d.getHours()+1);
        hf.value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      });
    }, 0);

    if (!esTerapeuta) {
      const selTer = document.getElementById('agendaTerapeuta');
      api('/terapeutas').then(ts => {
        const sel = document.getElementById('f_terapeuta_id');
        if (!sel) return;
        sel.innerHTML = ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        if (selTer?.value) sel.value = selTer.value;
      }).catch(() => {});
    }

    const searchInput = document.getElementById('f_paciente_search');
    const hiddenId    = document.getElementById('f_paciente_id');
    const dropdown    = document.getElementById('f_paciente_dropdown');

    if (pacienteSeleccionado) {
      const p = pacientesCache.find(x => String(x.id)===String(pacienteSeleccionado));
      if (p) { hiddenId.value = p.id; searchInput.value = fullName(p); }
    }

    function renderDropdown(q) {
      const matches = pacientesCache.filter(p =>
        fullName(p).toLowerCase().includes(q.toLowerCase()) ||
        (p.telefono||'').includes(q) ||
        (p.email||'').toLowerCase().includes(q.toLowerCase())
      ).slice(0,10);
      if (!matches.length) { dropdown.style.display='none'; return; }
      dropdown.innerHTML = matches.map(p =>
        `<div class="autocomplete-item" data-pid="${p.id}" data-tid="${p.terapeuta_id||''}">
          <strong>${esc(fullName(p))}</strong>
          ${p.terapeuta_nombre?`<span> — ${esc(p.terapeuta_nombre)}</span>`:''}
        </div>`
      ).join('');
      dropdown.style.display = 'block';
      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          hiddenId.value    = item.dataset.pid;
          searchInput.value = item.querySelector('strong').textContent;
          dropdown.style.display = 'none';
          const sel = document.getElementById('f_terapeuta_id');
          if (item.dataset.tid && sel) sel.value = item.dataset.tid;
        });
      });
    }

    searchInput?.addEventListener('input', e => {
      hiddenId.value = '';
      const q = e.target.value.trim();
      if (q.length < 1) { dropdown.style.display='none'; return; }
      renderDropdown(q);
    });
    searchInput?.addEventListener('focus', e => { if (e.target.value.trim()) renderDropdown(e.target.value.trim()); });
    searchInput?.addEventListener('blur',  () => setTimeout(() => { dropdown.style.display='none'; }, 150));
  }

  /* ── Listeners ──────────────────────────────────────── */
  document.getElementById('agendaTerapeuta')?.addEventListener('change', async e => {
    terapeutaId = e.target.value;
    pacienteSeleccionado = null;
    showDetailEmpty();
    await loadSidebar();
  });
  document.getElementById('agendaSearch')?.addEventListener('input', renderPacList);
  document.getElementById('agendaPaciente')?.addEventListener('change', e => { selectPaciente(e.target.value||null); });
  document.getElementById('btnNuevaCita')?.addEventListener('click', showNuevaCita);
  document.getElementById('btnCargaMasiva')?.addEventListener('click', showCargaMasiva);

  /* ── Init ───────────────────────────────────────────── */
  loadSidebar();

})();
