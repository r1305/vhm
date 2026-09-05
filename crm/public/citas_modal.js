/* ═══════════════════════════════════════════════════════
   VHM CRM — citas_modal.js
   Modales compartidos: nueva cita, editar cita, eliminar cita
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, openModal, closeModal, fullName, ESTADO_CITA, estadoCitaOptionsHtml } = window.CRM;

  const TIPO_CITA = {
    primera_vez: 'Primera consulta', seguimiento: 'Tratamiento',
    evaluacion: 'Seguimiento', urgencia: 'Urgencia',
  };
  const MODALIDAD_LABEL = { presencial: 'Presencial', videollamada: 'Videollamada', telefono: 'Teléfono' };

  function pacientesCache() { return window.CRM.pacientesCache || []; }

  function fmtFecha(v) { return v ? String(v).slice(0, 10) : '—'; }
  function fmtHora(v) { return v ? String(v).slice(0, 5) : '—'; }
  function lblEstado(v) { return ESTADO_CITA[v]?.label || v || '—'; }
  function lblTipo(v) { return TIPO_CITA[v] || v || '—'; }
  function lblModalidad(v) { return MODALIDAD_LABEL[v] || v || '—'; }

  function normCita(c) {
    return {
      fecha: fmtFecha(c.fecha),
      hora_inicio: fmtHora(c.hora_inicio),
      hora_fin: fmtHora(c.hora_fin),
      modalidad: c.modalidad || 'presencial',
      tipo: c.tipo || 'seguimiento',
      estado: c.estado || 'pendiente',
      notas: (c.notas || '').trim(),
    };
  }

  function buildDiffRows(original, updated) {
    const fields = [
      { key: 'fecha', label: 'Fecha', fmt: fmtFecha },
      { key: 'hora_inicio', label: 'Hora inicio', fmt: fmtHora },
      { key: 'hora_fin', label: 'Hora fin', fmt: fmtHora },
      { key: 'modalidad', label: 'Modalidad', fmt: lblModalidad },
      { key: 'tipo', label: 'Tipo', fmt: lblTipo },
      { key: 'estado', label: 'Estado', fmt: lblEstado },
      { key: 'notas', label: 'Observaciones', fmt: v => v || '—' },
    ];
    return fields
      .filter(f => String(original[f.key]) !== String(updated[f.key]))
      .map(f => ({
        label: f.label,
        before: f.fmt(original[f.key]),
        after: f.fmt(updated[f.key]),
      }));
  }

  function diffTableHtml(rows) {
    if (!rows.length) return '<p>No hay cambios.</p>';
    return `
      <p style="margin-bottom:10px;font-size:13px;color:var(--text-muted)">Revisa los cambios antes de confirmar:</p>
      <table class="cita-diff-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:2px solid var(--border);color:var(--text-muted)">
            <th style="padding:8px;text-align:left">Campo</th>
            <th style="padding:8px;text-align:left">Anterior</th>
            <th style="padding:8px;text-align:left">Nuevo</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px;font-weight:600">${esc(r.label)}</td>
              <td style="padding:8px;color:var(--text-muted)">${esc(r.before)}</td>
              <td style="padding:8px;color:var(--primary)">${esc(r.after)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function bindHoraFinAuto() {
    const hi = document.getElementById('f_hora_inicio');
    const hf = document.getElementById('f_hora_fin');
    if (!hi || !hf) return;
    hi.addEventListener('change', () => {
      if (!hi.value) return;
      const [h, m] = hi.value.split(':').map(Number);
      const d = new Date(2000, 0, 1, h, m);
      d.setHours(d.getHours() + 1);
      hf.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
  }

  function bindPacienteSearch(preselected = null) {
    const searchInput = document.getElementById('f_paciente_search');
    const hiddenId = document.getElementById('f_paciente_id');
    if (!searchInput || !hiddenId) return;

    if (preselected) {
      hiddenId.value = preselected.id;
      searchInput.value = fullName(preselected);
      return;
    }

    const dropdown = document.getElementById('f_paciente_dropdown');
    if (!dropdown) return;

    function renderDropdown(q) {
      const matches = pacientesCache().filter(p =>
        fullName(p).toLowerCase().includes(q.toLowerCase()) ||
        (p.telefono || '').includes(q) ||
        (p.email || '').toLowerCase().includes(q.toLowerCase())
      ).slice(0, 10);
      if (!matches.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = matches.map(p =>
        `<div class="autocomplete-item" data-pid="${p.id}" data-tid="${p.terapeuta_id || ''}">
          <strong>${esc(fullName(p))}</strong>
          ${p.terapeuta_nombre ? `<span> — ${esc(p.terapeuta_nombre)}</span>` : ''}
        </div>`
      ).join('');
      dropdown.style.display = 'block';
      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          hiddenId.value = item.dataset.pid;
          searchInput.value = item.querySelector('strong').textContent;
          dropdown.style.display = 'none';
          const sel = document.getElementById('f_terapeuta_id');
          if (item.dataset.tid && sel && sel.tagName === 'SELECT') sel.value = item.dataset.tid;
        });
      });
    }

    searchInput.addEventListener('input', e => {
      hiddenId.value = '';
      const q = e.target.value.trim();
      if (q.length < 1) { dropdown.style.display = 'none'; return; }
      renderDropdown(q);
    });
    searchInput.addEventListener('focus', e => { if (e.target.value.trim()) renderDropdown(e.target.value.trim()); });
    searchInput.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 150));
  }

  function showConfirmEliminarCita(citaId, onSuccess) {
    openModal('Eliminar cita', `
      <div style="text-align:center;padding:12px 0">
        <i class="fas fa-triangle-exclamation" style="font-size:36px;color:var(--danger);margin-bottom:12px"></i>
        <p style="font-size:15px;margin-bottom:8px">¿Eliminar esta cita?</p>
        <p style="font-size:13px;color:var(--text-muted)">Esta acción no se puede deshacer.</p>
      </div>`, async () => {
      await api(`/citas/${citaId}`, { method: 'DELETE' });
      toast('Cita eliminada');
      if (onSuccess) await onSuccess();
    }, { saveLabel: 'Eliminar', saveClass: 'btn btn-danger' });
  }

  function showEditarCita(cita, onSuccess) {
    if (!cita?.id) return;
    const esTerapeuta = window.__USER_ROL__ === 'terapeuta';
    const original = normCita(cita);
    const fechaISO = original.fecha !== '—' ? original.fecha : '';
    const tipoOpts = Object.entries(TIPO_CITA)
      .map(([v, l]) => `<option value="${v}" ${original.tipo === v ? 'selected' : ''}>${l}</option>`).join('');
    const modOpts = Object.entries(MODALIDAD_LABEL)
      .map(([v, l]) => `<option value="${v}" ${original.modalidad === v ? 'selected' : ''}>${l}</option>`).join('');

    openModal('Editar cita', `
      ${cita.meet_link ? `<div style="margin-bottom:14px"><a href="${esc(cita.meet_link)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="color:#1a73e8;border-color:#1a73e8"><i class="fas fa-video"></i> Unirse a Google Meet</a></div>` : ''}
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Fecha *</label>
          <input type="date" class="form-control" id="f_edit_fecha" value="${esc(fechaISO)}">
        </div>
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-select" id="f_edit_estado">${estadoCitaOptionsHtml(original.estado)}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Hora inicio</label>
          <input type="time" class="form-control" id="f_edit_hora_inicio" value="${esc(original.hora_inicio !== '—' ? original.hora_inicio : '17:00')}">
        </div>
        <div class="form-group">
          <label class="form-label">Hora fin</label>
          <input type="time" class="form-control" id="f_edit_hora_fin" value="${esc(original.hora_fin !== '—' ? original.hora_fin : '18:00')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Modalidad</label>
          <select class="form-select" id="f_edit_modalidad">${modOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <select class="form-select" id="f_edit_tipo">${tipoOpts}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones${esTerapeuta ? ' *' : ''}</label>
        <textarea class="form-control" id="f_edit_notas" rows="3">${esc(original.notas)}</textarea>
      </div>`, async () => {
      const updated = {
        fecha: document.getElementById('f_edit_fecha').value,
        hora_inicio: document.getElementById('f_edit_hora_inicio').value || '17:00',
        hora_fin: document.getElementById('f_edit_hora_fin').value || '18:00',
        modalidad: document.getElementById('f_edit_modalidad').value,
        tipo: document.getElementById('f_edit_tipo').value,
        estado: document.getElementById('f_edit_estado').value,
        notas: document.getElementById('f_edit_notas').value.trim(),
      };
      if (!updated.fecha) throw new Error('La fecha es obligatoria');
      if (esTerapeuta && !updated.notas) throw new Error('Las observaciones son obligatorias');
      const diff = buildDiffRows(original, updated);
      if (!diff.length) throw new Error('No hay cambios para guardar');

      closeModal();
      setTimeout(() => {
        openModal('Confirmar cambios', diffTableHtml(diff), async () => {
          await api(`/citas/${cita.id}`, { method: 'PUT', body: updated });
          toast('Cita actualizada');
          if (onSuccess) await onSuccess();
        }, { saveLabel: 'Confirmar cambios' });
      }, 80);
    }, { saveLabel: 'Revisar cambios' });

    setTimeout(() => {
      const hi = document.getElementById('f_edit_hora_inicio');
      const hf = document.getElementById('f_edit_hora_fin');
      if (hi && hf) {
        hi.addEventListener('change', () => {
          if (!hi.value) return;
          const [h, m] = hi.value.split(':').map(Number);
          const d = new Date(2000, 0, 1, h, m);
          d.setHours(d.getHours() + 1);
          hf.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        });
      }
    }, 0);
  }

  function showNuevaCita(opts = {}) {
    const { paciente = null, pacienteId = null, onSuccess } = opts;
    const preselected = paciente || (pacienteId
      ? pacientesCache().find(p => String(p.id) === String(pacienteId))
      : null);
    const hoy = new Date();
    const fechaISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const esTerapeuta = window.__USER_ROL__ === 'terapeuta';
    const pacienteLocked = !!preselected;

    openModal('Nueva cita', `
      <div class="form-group" style="position:relative">
        <label class="form-label">Paciente *</label>
        <input class="form-control${pacienteLocked ? ' form-control-locked' : ''}" id="f_paciente_search" autocomplete="off"
          placeholder="Buscar paciente…"
          ${pacienteLocked ? `readonly value="${esc(fullName(preselected))}"` : ''}>
        <input type="hidden" id="f_paciente_id" value="${pacienteLocked ? preselected.id : ''}">
        ${pacienteLocked
          ? '<p class="form-hint"><i class="fas fa-lock"></i> Paciente seleccionado en la agenda</p>'
          : '<div id="f_paciente_dropdown" class="autocomplete-dropdown" style="display:none"></div>'}
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
          <select class="form-select" id="f_estado">${estadoCitaOptionsHtml('pendiente')}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones${esTerapeuta ? ' *' : ''}</label>
        <textarea class="form-control" id="f_notas" rows="2"></textarea>
      </div>`, async () => {
      const notas = document.getElementById('f_notas').value.trim();
      if (esTerapeuta && !notas) throw new Error('Las observaciones son obligatorias');
      const body = {
        paciente_id: document.getElementById('f_paciente_id').value,
        terapeuta_id: document.getElementById('f_terapeuta_id').value,
        fecha: document.getElementById('f_fecha').value,
        hora_inicio: document.getElementById('f_hora_inicio').value || '17:00',
        hora_fin: document.getElementById('f_hora_fin').value || '18:00',
        modalidad: document.getElementById('f_modalidad').value,
        tipo: document.getElementById('f_tipo').value,
        estado: document.getElementById('f_estado').value,
        notas,
      };
      if (!body.paciente_id || !body.terapeuta_id || !body.fecha)
        throw new Error('Completa todos los campos requeridos');
      await api('/citas', { method: 'POST', body });
      toast('Cita creada');
      if (onSuccess) await onSuccess(body);
    });

    setTimeout(() => {
      bindHoraFinAuto();
      bindPacienteSearch(preselected);
      if (preselected?.terapeuta_id) {
        const sel = document.getElementById('f_terapeuta_id');
        if (sel && sel.tagName === 'SELECT') sel.value = preselected.terapeuta_id;
      }
    }, 0);

    if (!esTerapeuta) {
      api('/terapeutas').then(ts => {
        const sel = document.getElementById('f_terapeuta_id');
        if (!sel) return;
        sel.innerHTML = ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        const defaultTid = preselected?.terapeuta_id || document.getElementById('agendaTerapeuta')?.value;
        if (defaultTid) sel.value = defaultTid;
      }).catch(() => {});
    }
  }

  function bindCitaActions(container, citas, onRefresh) {
    const byId = id => citas.find(c => String(c.id) === String(id));

    container.querySelectorAll('[data-cita-editar]').forEach(btn =>
      btn.addEventListener('click', () => showEditarCita(byId(btn.dataset.citaEditar), onRefresh))
    );
    container.querySelectorAll('[data-send-rec]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          await api(`/citas/${btn.dataset.sendRec}/recordatorio`, { method: 'POST' });
          toast('Recordatorio enviado');
        } catch (e) { toast(e.message, 'danger'); }
      })
    );
    container.querySelectorAll('[data-confirmar]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          await api(`/citas/${btn.dataset.confirmar}/estado`, { method: 'PATCH', body: { estado: 'realizada' } });
          toast('Sesión marcada como realizada');
          if (onRefresh) await onRefresh();
        } catch (e) { toast(e.message, 'danger'); }
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
          await api(`/citas/${btn.dataset.cancelar}/estado`, { method: 'PATCH', body: { estado: 'cancelada', notas: motivo } });
          toast('Sesión cancelada');
          if (onRefresh) await onRefresh();
        });
      })
    );
    container.querySelectorAll('[data-eliminar]').forEach(btn =>
      btn.addEventListener('click', () => showConfirmEliminarCita(btn.dataset.eliminar, onRefresh))
    );
  }

  window.CRM_CITAS = { showNuevaCita, showEditarCita, showConfirmEliminarCita, bindCitaActions };
})();
