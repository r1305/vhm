/* ═══════════════════════════════════════════════════════
   VHM CRM — agenda.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, openModal, ESTADO_CITA, fullName } = window.CRM;

  let fechaActual  = new Date();
  let terapeutaId  = document.getElementById('agendaTerapeuta')?.value || '';
  let pacientesCache = [];

  /* ── Timeline ───────────────────────────────────────── */
  async function loadAgenda() {
    try {
      const qs = new URLSearchParams();
      const dia = document.getElementById('agendaDia').value;
      if (dia) {
        qs.set('fecha', dia);
      } else {
        qs.set('mes', `${fechaActual.getFullYear()}-${String(fechaActual.getMonth()+1).padStart(2,'0')}`);
      }
      const tid = document.getElementById('agendaTerapeuta').value;
      const pid = document.getElementById('agendaPaciente').value;
      if (tid) qs.set('terapeuta_id', tid);
      if (pid) qs.set('paciente_id', pid);

      const citas = await api(`/citas?${qs}`);
      const tl    = document.getElementById('agendaTimeline');
      if (!citas.length) { tl.innerHTML = '<div class="list-empty">Sin citas para este período</div>'; return; }

      const grupos = {}, orden = [];
      citas.forEach(c => {
        const key = String(c.paciente_id);
        if (!grupos[key]) { grupos[key] = { info: c, citas: [] }; orden.push(key); }
        grupos[key].citas.push(c);
      });

      tl.innerHTML = orden.map(key => {
        const { info, citas: cs } = grupos[key];
        const nombre  = `${esc(info.paciente_nombre||'')} ${esc(info.paciente_apellido||'')}`.trim();
        const inicial = (info.paciente_nombre?.[0] || '?').toUpperCase();
        const filas   = cs.map(c => `
          <div class="ag-cita-row" data-id="${c.id}">
            <div class="ag-cita-time">${c.fecha ? c.fecha.slice(0,10) : '—'}</div>
            <div class="ag-cita-info">
              <span class="ag-cita-tipo">${esc(c.tipo)}</span>
              <span class="ag-cita-meta">${esc(c.terapeuta_nombre)} · ${esc(c.modalidad)}</span>
            </div>
            <span class="badge ${(ESTADO_CITA[c.estado]||{css:'badge-gray'}).css}">${(ESTADO_CITA[c.estado]||{label:c.estado}).label}</span>
            <div class="ag-cita-actions">
              <button class="btn-icon" data-cita-estado="${c.id}" data-actual="${c.estado}" data-notas="${esc(c.notas||'')}" title="Cambiar estado"><i class="fas fa-pen"></i></button>
              <button class="btn-icon" data-send-rec="${c.id}" title="Enviar recordatorio"><i class="fas fa-bell"></i></button>
              ${c.estado !== 'realizada' ? `<button class="btn-icon" style="color:var(--success)" data-confirmar="${c.id}" title="Marcar realizada"><i class="fas fa-circle-check"></i></button>` : ''}
              ${c.estado !== 'realizada' && c.estado !== 'cancelada' ? `<button class="btn-icon" style="color:var(--danger)" data-cancelar="${c.id}" title="Cancelar"><i class="fas fa-circle-xmark"></i></button>` : ''}
              ${(c.estado === 'pendiente' || window.__USER_ROL__ !== 'terapeuta') ? `<button class="btn-icon" style="color:var(--danger)" data-eliminar="${c.id}" title="Eliminar cita"><i class="fas fa-trash"></i></button>` : ''}
            </div>
          </div>`).join('');
        return `
          <div class="ag-pac-card">
            <details>
              <summary class="ag-pac-summary">
                <div class="ag-pac-avatar">${inicial}</div>
                <div class="ag-pac-name">${nombre}</div>
                <span class="ag-pac-count">${cs.length} cita${cs.length!==1?'s':''}</span>
                <i class="fas fa-chevron-down ag-pac-chevron"></i>
              </summary>
              <div class="ag-citas-list">${filas}</div>
            </details>
          </div>`;
      }).join('');

      tl.querySelectorAll('[data-cita-estado]').forEach(btn =>
        btn.addEventListener('click', () => showCambioEstado(btn.dataset.citaEstado, btn.dataset.actual, btn.dataset.notas))
      );
      tl.querySelectorAll('[data-send-rec]').forEach(btn =>
        btn.addEventListener('click', async () => {
          try { await api(`/citas/${btn.dataset.sendRec}/recordatorio`, { method: 'POST' }); toast('Recordatorio enviado'); }
          catch (e) { toast(e.message, 'danger'); }
        })
      );
      tl.querySelectorAll('[data-confirmar]').forEach(btn =>
        btn.addEventListener('click', async () => {
          try {
            await api(`/citas/${btn.dataset.confirmar}/estado`, { method: 'PATCH', body: { estado: 'realizada' } });
            toast('Sesión marcada como realizada'); loadAgenda();
          } catch (e) { toast(e.message, 'danger'); }
        })
      );
      tl.querySelectorAll('[data-cancelar]').forEach(btn =>
        btn.addEventListener('click', () => {
          openModal('Cancelar sesión', `
            <div class="form-group">
              <label class="form-label">Motivo *</label>
              <textarea class="form-control" id="f_motivo_cancelacion" rows="3" placeholder="Indica el motivo…"></textarea>
            </div>`, async () => {
            const motivo = document.getElementById('f_motivo_cancelacion').value.trim();
            if (!motivo) throw new Error('Debes ingresar un motivo');
            await api(`/citas/${btn.dataset.cancelar}/estado`, { method: 'PATCH', body: { estado: 'cancelada', notas: motivo } });
            toast('Sesión cancelada'); loadAgenda();
          });
        })
      );
      tl.querySelectorAll('[data-eliminar]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta cita pendiente?')) return;
          try {
            await api(`/citas/${btn.dataset.eliminar}`, { method: 'DELETE' });
            toast('Cita eliminada'); loadAgenda();
          } catch (e) { toast(e.message, 'danger'); }
        })
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  /* ── Carga masiva ──────────────────────────────────── */
  function showCargaMasiva() {
    const tipoOpts = [
      ['primera_vez','Primera consulta'],
      ['seguimiento','Tratamiento'],
      ['evaluacion','Seguimiento'],
      ['urgencia','Urgencia'],
    ].map(([v,l]) => `<option value="${v}">${l}</option>`).join('');

    const estadoOpts = Object.entries(ESTADO_CITA)
      .map(([k,v]) => `<option value="${k}" ${k==='realizada'?'selected':''}>${v.label}</option>`).join('');

    const modalidadOpts = [
      ['presencial','Presencial'],
      ['videollamada','Videollamada','selected'],
      ['telefono','Teléfono'],
    ].map(([v,l,s]) => `<option value="${v}" ${s||''}>${l}</option>`).join('');

    let terapeutasCache = [];

    function filaHTML(vals = {}) {
      const tid = vals.terapeuta_id || document.getElementById('agendaTerapeuta')?.value || '';
      const terOpts = terapeutasCache.map(t =>
        `<option value="${t.id}" ${String(t.id)===String(tid)?'selected':''}>${esc(fullName(t))}</option>`
      ).join('');
      return `<tr>
        <td style="padding:3px 4px;position:relative">
          <input class="form-control form-control-sm cm-pac-search" autocomplete="off" placeholder="Buscar…"
            value="${esc(vals.paciente_nombre||'')}" style="min-width:160px">
          <input type="hidden" class="cm-paciente" value="${vals.paciente_id||''}">
          <div class="cm-pac-drop autocomplete-dropdown" style="display:none;position:absolute;z-index:999;min-width:200px"></div>
        </td>
        <td style="padding:3px 4px">
          <select class="form-select form-select-sm cm-terapeuta" style="min-width:130px">
            <option value="">— Terapeuta —</option>${terOpts}
          </select>
        </td>
        <td style="padding:3px 4px"><input type="date" class="form-control form-control-sm cm-fecha" value="${vals.fecha||''}" style="min-width:130px"></td>
        <td style="padding:3px 4px"><select class="form-select form-select-sm cm-modalidad" style="min-width:110px">${modalidadOpts.replace(vals.modalidad?`value="${vals.modalidad}"`:'^','$& selected')}</select></td>
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
      if (el) el.textContent = `${n} fila${n !== 1 ? 's' : ''}`;
    }

    function getFilaVals(tr) {
      return {
        paciente_id:    tr.querySelector('.cm-paciente').value,
        paciente_nombre: tr.querySelector('.cm-pac-search').value,
        terapeuta_id:   tr.querySelector('.cm-terapeuta').value,
        fecha:          tr.querySelector('.cm-fecha').value,
        modalidad:      tr.querySelector('.cm-modalidad').value,
        tipo:           tr.querySelector('.cm-tipo').value,
        estado:         tr.querySelector('.cm-estado').value,
        notas:          tr.querySelector('.cm-notas').value,
      };
    }

    function bindFila(tr) {
      // Eliminar
      tr.querySelector('.cm-del').onclick = () => { tr.remove(); actualizarContador(); };

      // Clonar
      tr.querySelector('.cm-clone').onclick = () => {
        const vals = getFilaVals(tr);
        const tmp = document.createElement('tbody');
        tmp.innerHTML = filaHTML(vals);
        const nueva = tmp.firstElementChild;
        tr.after(nueva);
        // Restaurar selects (modalidad/tipo/estado no se restauran bien via innerHTML replace)
        nueva.querySelector('.cm-modalidad').value = vals.modalidad;
        nueva.querySelector('.cm-tipo').value      = vals.tipo;
        nueva.querySelector('.cm-estado').value    = vals.estado;
        bindFila(nueva);
        bindPacSearch(nueva);
        actualizarContador();
      };
    }

    function bindPacSearch(tr) {
      const input  = tr.querySelector('.cm-pac-search');
      const hidden = tr.querySelector('.cm-paciente');
      const drop   = tr.querySelector('.cm-pac-drop');

      input.addEventListener('input', () => {
        hidden.value = '';
        const q = input.value.trim().toLowerCase();
        if (!q) { drop.style.display = 'none'; return; }
        const tidFila = tr.querySelector('.cm-terapeuta').value;
        const pool = tidFila
          ? pacientesCache.filter(p => String(p.terapeuta_id) === String(tidFila))
          : pacientesCache;
        const matches = pool.filter(p =>
          fullName(p).toLowerCase().includes(q) ||
          (p.telefono||'').includes(q)
        ).slice(0, 8);
        if (!matches.length) { drop.style.display = 'none'; return; }
        drop.innerHTML = matches.map(p =>
          `<div class="autocomplete-item" data-pid="${p.id}" data-tid="${p.terapeuta_id||''}" data-name="${esc(fullName(p))}">
            <strong>${esc(fullName(p))}</strong>
            ${p.terapeuta_nombre ? `<span style="color:var(--text-muted)"> — ${esc(p.terapeuta_nombre)}</span>` : ''}
          </div>`
        ).join('');
        drop.style.display = 'block';
        drop.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('mousedown', e => {
            e.preventDefault();
            hidden.value  = item.dataset.pid;
            input.value   = item.dataset.name;
            drop.style.display = 'none';
            if (item.dataset.tid) tr.querySelector('.cm-terapeuta').value = item.dataset.tid;
          });
        });
      });
      input.addEventListener('blur', () => setTimeout(() => { drop.style.display = 'none'; }, 150));
    }

    // Modal con ancho extra via estilo inline en el contenedor
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
          throw new Error(`Fila ${i + 1}: paciente, terapeuta y fecha son obligatorios`);
        citas.push({
          paciente_id,
          terapeuta_id,
          fecha,
          modalidad: fila.querySelector('.cm-modalidad').value,
          tipo:      fila.querySelector('.cm-tipo').value,
          estado:    fila.querySelector('.cm-estado').value,
          notas:     fila.querySelector('.cm-notas').value,
        });
      }
      const resultados = await Promise.allSettled(
        citas.map(c => api('/citas', { method: 'POST', body: c }))
      );
      const ok      = resultados.filter(r => r.status === 'fulfilled').length;
      const errores = resultados.filter(r => r.status === 'rejected').length;
      toast(`${ok} cita${ok !== 1 ? 's' : ''} creada${ok !== 1 ? 's' : ''}${errores ? ` · ${errores} error${errores !== 1 ? 'es' : ''}` : ''}`, errores ? 'info' : 'success');
      loadAgenda();
    }, { large: true });

    // Ampliar el modal más allá del tamaño lg estándar
    setTimeout(() => {
      const m = document.getElementById('modal');
      if (m) m.style.maxWidth = '95vw';
    }, 0);

    // Si el cache está vacío (no se ha cambiado el filtro de agenda), cargarlo ahora
    if (!pacientesCache.length) {
      const tid = document.getElementById('agendaTerapeuta')?.value || '';
      const qs = new URLSearchParams();
      if (tid) qs.set('terapeuta_id', tid);
      api(`/pacientes?${qs}`).then(ps => { pacientesCache = ps; }).catch(() => {});
    }

    // Cargar terapeutas, luego insertar primera fila
    api('/terapeutas').then(ts => {
      terapeutasCache = ts;
      const tbody = document.getElementById('cmBody');
      if (!tbody) return;
      const tmp = document.createElement('tbody');
      tmp.innerHTML = filaHTML();
      const fila = tmp.firstElementChild;
      tbody.appendChild(fila);
      bindFila(fila);
      bindPacSearch(fila);
      actualizarContador();
    }).catch(() => {});

    document.getElementById('cmAgregarFila')?.addEventListener('click', () => {
      const tbody = document.getElementById('cmBody');
      const tmp = document.createElement('tbody');
      tmp.innerHTML = filaHTML();
      const fila = tmp.firstElementChild;
      tbody.appendChild(fila);
      bindFila(fila);
      bindPacSearch(fila);
      actualizarContador();
    });
  }

  /* ── Cambio de estado ───────────────────────────────── */
  function showCambioEstado(id, actual, notasActual = '') {
    openModal('Editar cita', `
      <div class="form-group">
        <label class="form-label">Estado</label>
        <select class="form-select" id="f_estado_cita">
          ${Object.entries(ESTADO_CITA).map(([k,v]) =>
            `<option value="${k}" ${k===actual?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones *</label>
        <textarea class="form-control" id="f_notas_cita" rows="3">${esc(notasActual)}</textarea>
      </div>`, async () => {
      const notas = document.getElementById('f_notas_cita').value.trim();
      if (!notas) throw new Error('Las observaciones son obligatorias');
      await api(`/citas/${id}/estado`, { method: 'PATCH', body: { estado: document.getElementById('f_estado_cita').value, notas } });
      toast('Cita actualizada'); loadAgenda();
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
        ${!esTerapeuta ? `
        <div class="form-group">
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
        <label class="form-label">Observaciones${esTerapeuta ? ' *' : ''}</label>
        <textarea class="form-control" id="f_notas" rows="2"></textarea>
      </div>`, async () => {
      const notas = document.getElementById('f_notas').value.trim();
      if (esTerapeuta && !notas) throw new Error('Las observaciones son obligatorias');
      const body = {
        paciente_id:  document.getElementById('f_paciente_id').value,
        terapeuta_id: document.getElementById('f_terapeuta_id').value,
        fecha:        document.getElementById('f_fecha').value,
        modalidad:    document.getElementById('f_modalidad').value,
        tipo:         document.getElementById('f_tipo').value,
        estado:       document.getElementById('f_estado').value,
        notas,
      };
      if (!body.paciente_id || !body.terapeuta_id || !body.fecha)
        throw new Error('Completa todos los campos requeridos');
      await api('/citas', { method: 'POST', body });
      toast('Cita creada'); loadAgenda();
    });

    // Poblar select terapeutas (solo para no-terapeutas)
    if (!esTerapeuta) {
      const selTer = document.getElementById('agendaTerapeuta');
      api('/terapeutas').then(ts => {
        const sel = document.getElementById('f_terapeuta_id');
        if (!sel) return;
        sel.innerHTML = ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        if (selTer?.value) sel.value = selTer.value;
      }).catch(() => {});
    }

    // Autocomplete paciente
    const searchInput = document.getElementById('f_paciente_search');
    const hiddenId    = document.getElementById('f_paciente_id');
    const dropdown    = document.getElementById('f_paciente_dropdown');

    function renderDropdown(q) {
      const matches = pacientesCache.filter(p =>
        fullName(p).toLowerCase().includes(q.toLowerCase()) ||
        (p.telefono||'').includes(q) ||
        (p.email||'').toLowerCase().includes(q.toLowerCase())
      ).slice(0, 10);
      if (!matches.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = matches.map(p =>
        `<div class="autocomplete-item" data-pid="${p.id}" data-tid="${p.terapeuta_id||''}">
          <strong>${esc(fullName(p))}</strong>
          ${p.terapeuta_nombre ? `<span> — ${esc(p.terapeuta_nombre)}</span>` : ''}
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
      if (q.length < 1) { dropdown.style.display = 'none'; return; }
      renderDropdown(q);
    });
    searchInput?.addEventListener('focus', e => { if (e.target.value.trim()) renderDropdown(e.target.value.trim()); });
    searchInput?.addEventListener('blur',  () => setTimeout(() => { dropdown.style.display = 'none'; }, 150));
  }

  /* ── Listeners ──────────────────────────────────────── */
  document.getElementById('agendaTerapeuta').addEventListener('change', async e => {
    terapeutaId = e.target.value;
    const qs = new URLSearchParams();
    if (terapeutaId) qs.set('terapeuta_id', terapeutaId);
    pacientesCache = await api(`/pacientes?${qs}`).catch(() => []);
    const sel = document.getElementById('agendaPaciente');
    sel.innerHTML = `<option value="">Todos los pacientes</option>` +
      pacientesCache.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('');
    loadAgenda();
  });
  document.getElementById('agendaPaciente').addEventListener('change', loadAgenda);
  document.getElementById('agendaMes').addEventListener('change', e => {
    const [anio, mes] = e.target.value.split('-').map(Number);
    const hoy = new Date();
    fechaActual = (anio === hoy.getFullYear() && mes-1 === hoy.getMonth()) ? hoy : new Date(anio, mes-1, 15);
    document.getElementById('agendaDia').value = '';
    loadAgenda();
  });
  document.getElementById('agendaDia').addEventListener('change', e => {
    if (e.target.value) { const [y,m,d] = e.target.value.split('-').map(Number); fechaActual = new Date(y,m-1,d); }
    loadAgenda();
  });
  document.getElementById('btnNuevaCita').addEventListener('click', showNuevaCita);
  document.getElementById('btnCargaMasiva')?.addEventListener('click', showCargaMasiva);

  /* ── Init ───────────────────────────────────────────── */
  api(`/pacientes${terapeutaId ? `?terapeuta_id=${terapeutaId}` : ''}`).then(ps => {
    pacientesCache = ps;
    window.CRM.pacientesCache = ps;
  }).catch(() => {});

  loadAgenda();

})();
