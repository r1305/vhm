/* ═══════════════════════════════════════════════════════
   VHM CRM — queue.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, fullName, openModal } = window.CRM;

  async function loadEspera() {
    try {
      const data = await api('/reportes/lista-espera');
      document.getElementById('listaEsperaContent').innerHTML = data.length
        ? data.map(item => `
          <div class="list-item">
            <div class="list-icon"><i class="fas fa-hourglass-half"></i></div>
            <div style="flex:1">
              <div class="list-title">${esc(item.nombre)} ${esc(item.apellido||'')}</div>
              <div class="list-meta">
                ${item.email ? `<span>${esc(item.email)}</span>` : ''}
                ${item.especialidad ? `<span>· ${esc(item.especialidad)}</span>` : ''}
                <span>· Desde ${fmtDate(item.fecha_solicitud)}</span>
                ${item.notificado ? '<span class="badge badge-green" style="margin-left:4px">Notificado</span>' : ''}
              </div>
            </div>
            ${!item.notificado ? `<button class="btn btn-sm btn-outline" data-notif="${item.id}"><i class="fas fa-bell"></i> Notificar</button>` : ''}
          </div>`).join('')
        : '<div class="list-empty">Lista de espera vacía</div>';

      document.querySelectorAll('[data-notif]').forEach(btn =>
        btn.addEventListener('click', async () => {
          try {
            await api(`/reportes/lista-espera/${btn.dataset.notif}/notificar`, { method: 'POST' });
            toast('Notificación enviada'); loadEspera();
          } catch (err) { toast(err.message, 'danger'); }
        })
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  async function showNuevoEspera() {
    const [ps, ts] = await Promise.all([api('/pacientes').catch(()=>[]), api('/terapeutas').catch(()=>[])]);
    openModal('Agregar a lista de espera', `
      <div class="form-group"><label class="form-label">Paciente *</label>
        <select class="form-select" id="f_paciente_id">
          <option value="">— Seleccionar —</option>
          ${ps.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Terapeuta preferido</label>
        <select class="form-select" id="f_terapeuta_id">
          <option value="">— Sin preferencia —</option>
          ${ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Especialidad requerida</label><input class="form-control" id="f_especialidad" placeholder="Ej: Ansiedad, Terapia de pareja…"></div>`,
      async () => {
        const body = {
          paciente_id:  document.getElementById('f_paciente_id').value,
          terapeuta_id: document.getElementById('f_terapeuta_id').value || null,
          especialidad: document.getElementById('f_especialidad').value || null,
        };
        if (!body.paciente_id) throw new Error('Selecciona un paciente');
        await api('/reportes/lista-espera', { method: 'POST', body });
        toast('Agregado a lista de espera'); loadEspera();
      });
  }

  document.getElementById('btnNuevoEspera').addEventListener('click', showNuevoEspera);
  loadEspera();

})();
