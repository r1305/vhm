/* ═══════════════════════════════════════════════════════
   VHM CRM — auto_assignment.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, openModal, viewLoaders, isAdmin } = window.CRM;

    async function loadReglas() {
      if (!isAdmin()) return;
      try {
        const data = await api('/leads/reglas');
        document.getElementById('tablaReglas').innerHTML = data.length
          ? data.map(r => `
            <tr>
              <td><code style="background:var(--primary-light);color:var(--primary);padding:2px 6px;border-radius:4px">${esc(r.keyword)}</code></td>
              <td>${esc(r.terapeuta_nombre)} ${esc(r.terapeuta_apellido)}</td>
              <td>${r.prioridad}</td>
              <td>
                <button class="btn-icon danger" data-del-regla="${r.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="4" class="list-empty">Sin reglas. Los leads se asignarán al terapeuta con menos carga.</td></tr>';

        document.querySelectorAll('[data-del-regla]').forEach(btn =>
          btn.addEventListener('click', async () => {
            await api(`/leads/reglas/${btn.dataset.delRegla}`, { method: 'DELETE' });
            toast('Regla eliminada');
            loadReglas();
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function showNuevaRegla() {
      const ts = await api('/terapeutas').catch(() => []);
      openModal('Nueva regla de asignación', `
        <div class="form-group">
          <label class="form-label">Palabra clave *</label>
          <input class="form-control" id="f_keyword" placeholder="ej: ansiedad, pareja, infantil, duelo…">
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Si el motivo de consulta contiene esta palabra, el lead se asigna al terapeuta seleccionado.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Terapeuta *</label>
          <select class="form-select" id="f_terapeuta_id">
            <option value="">— Seleccionar —</option>
            ${ts.filter(t => t.rol === 'terapeuta').map(t =>
              `<option value="${t.id}">${esc(t.nombre)} ${esc(t.apellido)} ${t.especialidad ? `— ${esc(t.especialidad)}` : ''}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Prioridad (1 = más alta)</label>
          <input type="number" min="1" max="99" class="form-control" id="f_prioridad" value="1">
        </div>`, async () => {
        const body = {
          keyword:      document.getElementById('f_keyword').value.trim(),
          terapeuta_id: document.getElementById('f_terapeuta_id').value,
          prioridad:    document.getElementById('f_prioridad').value || 1,
        };
        if (!body.keyword || !body.terapeuta_id)
          throw new Error('Keyword y terapeuta son requeridos');
        await api('/leads/reglas', { method: 'POST', body });
        toast('Regla creada');
        loadReglas();
      });
    }

    document.getElementById('btnNuevaRegla')?.addEventListener('click', showNuevaRegla);
    viewLoaders['asignacion'] = loadReglas;

  }); // ready
})();
