/* ═══════════════════════════════════════════════════════
   VHM CRM — leads.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, badge, fullName, openModal, ESTADO_LEAD, FUENTE_ICON } = window.CRM;

  async function loadLeads() {
    try {
      const estado = document.getElementById('filtroLeadEstado').value;
      const data   = await api(`/leads${estado ? `?estado=${estado}` : ''}`);
      document.getElementById('tablaLeads').innerHTML = data.length
        ? data.map(l => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="color:var(--primary)"><i class="${FUENTE_ICON[l.fuente]||'fas fa-circle-dot'}"></i></span>
                <div>
                  <strong>${esc(fullName(l)||'Sin nombre')}</strong>
                  <div style="font-size:11px;color:var(--text-muted)">${esc(l.email||l.telefono||'')}</div>
                </div>
              </div>
            </td>
            <td>
              <div>${esc(l.fuente)}</div>
              ${l.fuente_detalle ? `<div style="font-size:11px;color:var(--text-muted)">${esc(l.fuente_detalle)}</div>` : ''}
            </td>
            <td>${badge(l.estado, ESTADO_LEAD)}</td>
            <td>${fmtDate(l.created_at)}</td>
            <td style="white-space:nowrap">
              ${l.estado !== 'convertido' && l.estado !== 'descartado' ? `
                <button class="btn-icon" data-lead-estado="${l.id}" data-actual="${l.estado}" title="Cambiar estado"><i class="fas fa-arrows-rotate"></i></button>
                <button class="btn-icon" data-convertir="${l.id}" title="Convertir a paciente"><i class="fas fa-user-plus"></i></button>` : ''}
              <button class="btn-icon danger" data-edit="${l.id}" title="Editar"><i class="fas fa-pen"></i></button>
            </td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="list-empty">Sin leads</td></tr>';

      document.querySelectorAll('[data-lead-estado]').forEach(btn =>
        btn.addEventListener('click', () => showCambioEstado(btn.dataset.leadEstado, btn.dataset.actual))
      );
      document.querySelectorAll('[data-convertir]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm('¿Convertir este lead en paciente?')) return;
          try {
            const r = await api(`/leads/${btn.dataset.convertir}/convertir`, { method: 'POST', body: {} });
            toast(`Lead convertido → Paciente #${r.paciente_id}`); loadLeads();
          } catch (err) { toast(err.message, 'danger'); }
        })
      );
      document.querySelectorAll('[data-edit]').forEach(btn =>
        btn.addEventListener('click', () => showLeadForm(data.find(l => l.id == btn.dataset.edit)))
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  function showCambioEstado(id, actual) {
    openModal('Cambiar estado del lead', `
      <div class="form-group">
        <label class="form-label">Nuevo estado</label>
        <select class="form-select" id="f_estado_lead">
          ${Object.entries(ESTADO_LEAD).map(([k,v]) =>
            `<option value="${k}" ${k===actual?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>`, async () => {
      await api(`/leads/${id}/estado`, { method: 'PATCH', body: { estado: document.getElementById('f_estado_lead').value } });
      toast('Estado actualizado'); loadLeads();
    });
  }

  function showLeadForm(l = null) {
    openModal(l ? 'Editar lead' : 'Nuevo lead', `
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre</label><input class="form-control" id="f_nombre" value="${esc(l?.nombre||'')}"></div>
        <div class="form-group"><label class="form-label">Apellido</label><input class="form-control" id="f_apellido" value="${esc(l?.apellido||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-control" id="f_email" value="${esc(l?.email||'')}"></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="f_telefono" value="${esc(l?.telefono||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fuente</label>
          <select class="form-select" id="f_fuente">
            ${['instagram','tiktok','web','whatsapp','referido','otro'].map(f =>
              `<option value="${f}" ${(l?.fuente||'web')===f?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Estado</label>
          <select class="form-select" id="f_estado">
            ${Object.entries(ESTADO_LEAD).map(([k,v]) =>
              `<option value="${k}" ${(l?.estado||'nuevo')===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Detalle de fuente</label><input class="form-control" id="f_fuente_detalle" value="${esc(l?.fuente_detalle||'')}"></div>
      <div class="form-group"><label class="form-label">Mensaje / consulta</label><textarea class="form-control" id="f_mensaje" rows="3">${esc(l?.mensaje||'')}</textarea></div>`,
      async () => {
        const body = {
          nombre: document.getElementById('f_nombre').value, apellido: document.getElementById('f_apellido').value,
          email: document.getElementById('f_email').value, telefono: document.getElementById('f_telefono').value,
          fuente: document.getElementById('f_fuente').value, estado: document.getElementById('f_estado').value,
          fuente_detalle: document.getElementById('f_fuente_detalle').value,
          mensaje: document.getElementById('f_mensaje').value,
        };
        if (l) await api(`/leads/${l.id}`, { method: 'PUT', body });
        else   await api('/leads', { method: 'POST', body });
        toast(l ? 'Lead actualizado' : 'Lead creado'); loadLeads();
      });
  }

  document.getElementById('filtroLeadEstado').addEventListener('change', loadLeads);
  document.getElementById('btnNuevoLead').addEventListener('click', () => showLeadForm());
  loadLeads();

})();
