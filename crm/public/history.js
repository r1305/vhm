/* ═══════════════════════════════════════════════════════
   VHM CRM — history.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fullName, openModal, viewLoaders } = window.CRM;

    async function populatePacienteSelects() {
      const data = await api('/pacientes').catch(() => []);
      ['historialPacienteSelect', 'consPacienteSelect', 'pagosPacienteSelect'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const placeholder = sel.querySelector('option[value=""]')?.textContent || '— Seleccionar —';
        sel.innerHTML = `<option value="">${placeholder}</option>` +
          data.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('');
      });
    }

    let historialPacienteId = null;

    async function loadHistorial() {
      if (!historialPacienteId) return;
      try {
        const data = await api(`/historial/paciente/${historialPacienteId}`);
        document.getElementById('historialContent').innerHTML = data.length
          ? data.map(h => `
            <div class="note-card">
              <div class="note-meta">
                <span><i class="fas fa-user-md"></i> ${esc(h.terapeuta_nombre || '—')}</span>
                <span><i class="fas fa-calendar"></i> ${fmtDate(h.fecha)}</span>
                <span class="badge badge-gray">${esc(h.tipo)}</span>
                ${window.CRM.isAdmin() ? `<button class="btn-icon danger" data-del-nota="${h.id}" style="padding:0 4px"><i class="fas fa-trash"></i></button>` : ''}
              </div>
              <div class="note-text">${esc(h.nota)}</div>
            </div>`).join('')
          : '<div class="list-empty">Sin notas clínicas</div>';

        document.querySelectorAll('[data-del-nota]').forEach(btn =>
          btn.addEventListener('click', async () => {
            if (!confirm('¿Eliminar esta nota? No se puede deshacer.')) return;
            await api(`/historial/${btn.dataset.delNota}`, { method: 'DELETE' });
            toast('Nota eliminada');
            loadHistorial();
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    function showNuevaNota() {
      openModal('Nueva nota clínica', `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fecha *</label>
            <input type="date" class="form-control" id="f_fecha" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-select" id="f_tipo">
              <option value="evolucion">Evolución</option>
              <option value="evaluacion">Evaluación</option>
              <option value="derivacion">Derivación</option>
              <option value="alta">Alta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Nota clínica *</label>
          <textarea class="form-control" id="f_nota" rows="6" placeholder="Descripción de la sesión, observaciones, plan terapéutico…"></textarea>
        </div>`, async () => {
        const nota = document.getElementById('f_nota').value.trim();
        if (!nota) throw new Error('La nota no puede estar vacía');
        await api(`/historial/paciente/${historialPacienteId}`, {
          method: 'POST',
          body: {
            nota,
            tipo:  document.getElementById('f_tipo').value,
            fecha: document.getElementById('f_fecha').value,
          },
        });
        toast('Nota guardada');
        loadHistorial();
      }, { large: true });
    }

    document.getElementById('historialPacienteSelect').addEventListener('change', e => {
      historialPacienteId = e.target.value || null;
      document.getElementById('btnNuevaNota').disabled = !historialPacienteId;
      if (historialPacienteId) loadHistorial();
      else document.getElementById('historialContent').innerHTML = '<div class="list-empty">Selecciona un paciente para ver su historial</div>';
    });
    document.getElementById('btnNuevaNota').addEventListener('click', showNuevaNota);

    viewLoaders['historial'] = async () => {
      await populatePacienteSelects();
      if (historialPacienteId) loadHistorial();
    };

    // Exponer para que consent.js pueda reutilizarla
    window.CRM.populatePacienteSelects = populatePacienteSelects;

  }); // ready
})();
