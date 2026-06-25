/* ═══════════════════════════════════════════════════════
   VHM CRM — part3.js  Leads · Historial · Consentimientos
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, badge, fullName,
            openModal, viewLoaders,
            ESTADO_LEAD, FUENTE_ICON } = window.CRM;

    /* ══════════════════════════════════════════════════
       LEADS
    ══════════════════════════════════════════════════ */
    async function loadLeads() {
      try {
        const estado = document.getElementById('filtroLeadEstado').value;
        const data   = await api(`/leads${estado ? `?estado=${estado}` : ''}`);

        document.getElementById('tablaLeads').innerHTML = data.length
          ? data.map(l => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="color:var(--primary)"><i class="${FUENTE_ICON[l.fuente] || 'fas fa-circle-dot'}"></i></span>
                  <div>
                    <strong>${esc(fullName(l) || 'Sin nombre')}</strong>
                    <div style="font-size:11px;color:var(--text-muted)">${esc(l.email || l.telefono || '')}</div>
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
                ${l.estado !== 'convertido' && l.estado !== 'descartado'
                  ? `<button class="btn-icon" data-lead-estado="${l.id}" data-actual="${l.estado}" title="Cambiar estado"><i class="fas fa-arrows-rotate"></i></button>
                     <button class="btn-icon" data-convertir-lead="${l.id}" title="Convertir a paciente"><i class="fas fa-user-plus"></i></button>`
                  : ''}
                <button class="btn-icon danger" data-edit-lead="${l.id}" title="Editar"><i class="fas fa-pen"></i></button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="5" class="list-empty">Sin leads</td></tr>';

        document.querySelectorAll('[data-lead-estado]').forEach(btn =>
          btn.addEventListener('click', () => showCambioEstadoLead(btn.dataset.leadEstado, btn.dataset.actual))
        );
        document.querySelectorAll('[data-convertir-lead]').forEach(btn =>
          btn.addEventListener('click', () => convertirLead(btn.dataset.convertirLead))
        );
        document.querySelectorAll('[data-edit-lead]').forEach(btn =>
          btn.addEventListener('click', () => showLeadForm(data.find(l => l.id == btn.dataset.editLead)))
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    function showCambioEstadoLead(id, actual) {
      openModal('Cambiar estado del lead', `
        <div class="form-group">
          <label class="form-label">Nuevo estado</label>
          <select class="form-select" id="f_estado_lead">
            ${Object.entries(ESTADO_LEAD).map(([k, v]) =>
              `<option value="${k}" ${k === actual ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notas (opcional)</label>
          <textarea class="form-control" id="f_notas_lead" rows="2"></textarea>
        </div>`, async () => {
        await api(`/leads/${id}/estado`, {
          method: 'PATCH',
          body: { estado: document.getElementById('f_estado_lead').value },
        });
        toast('Estado actualizado');
        loadLeads();
      });
    }

    async function convertirLead(id) {
      if (!confirm('¿Convertir este lead en paciente?')) return;
      try {
        const r = await api(`/leads/${id}/convertir`, { method: 'POST', body: {} });
        toast(`Lead convertido → Paciente #${r.paciente_id}`);
        loadLeads();
      } catch (err) { toast(err.message, 'danger'); }
    }

    function showLeadForm(l = null) {
      openModal(l ? 'Editar lead' : 'Nuevo lead', `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nombre</label>
            <input class="form-control" id="f_nombre" value="${esc(l?.nombre || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Apellido</label>
            <input class="form-control" id="f_apellido" value="${esc(l?.apellido || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="f_email" value="${esc(l?.email || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Teléfono</label>
            <input class="form-control" id="f_telefono" value="${esc(l?.telefono || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fuente</label>
            <select class="form-select" id="f_fuente">
              ${['instagram','tiktok','web','whatsapp','referido','otro'].map(f =>
                `<option value="${f}" ${(l?.fuente || 'web') === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select class="form-select" id="f_estado">
              ${Object.entries(ESTADO_LEAD).map(([k, v]) =>
                `<option value="${k}" ${(l?.estado || 'nuevo') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Detalle de fuente (URL del post, campaña…)</label>
          <input class="form-control" id="f_fuente_detalle" value="${esc(l?.fuente_detalle || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Mensaje / consulta</label>
          <textarea class="form-control" id="f_mensaje" rows="3">${esc(l?.mensaje || '')}</textarea>
        </div>`, async () => {
        const body = {
          nombre:         document.getElementById('f_nombre').value,
          apellido:       document.getElementById('f_apellido').value,
          email:          document.getElementById('f_email').value,
          telefono:       document.getElementById('f_telefono').value,
          fuente:         document.getElementById('f_fuente').value,
          estado:         document.getElementById('f_estado').value,
          fuente_detalle: document.getElementById('f_fuente_detalle').value,
          mensaje:        document.getElementById('f_mensaje').value,
        };
        if (l) await api(`/leads/${l.id}`, { method: 'PUT', body });
        else   await api('/leads', { method: 'POST', body });
        toast(l ? 'Lead actualizado' : 'Lead creado');
        loadLeads();
      });
    }

    document.getElementById('filtroLeadEstado').addEventListener('change', loadLeads);
    document.getElementById('btnNuevoLead').addEventListener('click', () => showLeadForm());
    viewLoaders['leads'] = loadLeads;

    /* ══════════════════════════════════════════════════
       HISTORIAL CLÍNICO
    ══════════════════════════════════════════════════ */
    let historialPacienteId = null;

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

    /* ══════════════════════════════════════════════════
       CONSENTIMIENTOS
    ══════════════════════════════════════════════════ */
    let consPacienteId = null;

    async function loadConsentimientos() {
      if (!consPacienteId) return;
      try {
        const [[p]] = await Promise.all([
          api(`/pacientes/${consPacienteId}`).then(r => [r]).catch(() => [null]),
        ]);
        const firmado = p?.consentimiento;
        document.getElementById('consContent').innerHTML = `
          <div class="card-body">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
              <span class="badge ${firmado ? 'badge-green' : 'badge-red'}">
                <i class="fas ${firmado ? 'fa-check' : 'fa-times'}"></i>
                ${firmado ? 'Consentimiento firmado' : 'Sin consentimiento'}
              </span>
              ${firmado ? `<span style="font-size:12px;color:var(--text-muted)">Firmado el ${fmtDate(p.consentimiento_at)}</span>` : ''}
            </div>
            ${!firmado ? `
            <div style="background:var(--bg);border-radius:8px;padding:14px;font-size:13px;line-height:1.7;margin-bottom:16px;border:1px solid var(--border)">
              <strong>Consentimiento Informado para Proceso Terapéutico</strong><br><br>
              Yo, <strong>${esc(fullName(p || {}))}</strong>, declaro que he sido informado/a sobre la naturaleza 
              del proceso terapéutico, la confidencialidad de las sesiones (con las excepciones legales vigentes), 
              la posibilidad de cancelar el proceso en cualquier momento, y la política de cancelación de citas.<br><br>
              Al firmar este documento, acepto los términos del contrato terapéutico y autorizo el tratamiento 
              de mis datos personales con fines clínicos exclusivamente.
            </div>
            <button class="btn btn-primary" id="btnFirmarCons"><i class="fas fa-signature"></i> Registrar firma digital</button>
            ` : `<p style="font-size:13px;color:var(--text-muted)">El consentimiento ya fue firmado. Para revocarlo contacta al administrador.</p>`}
          </div>`;

        document.getElementById('btnFirmarCons')?.addEventListener('click', async () => {
          if (!confirm('¿Confirmar la firma digital del consentimiento?')) return;
          await api(`/pacientes/${consPacienteId}/consentimiento`, {
            method: 'POST',
            body: { tipo: 'terapeutico', texto: 'Consentimiento informado firmado digitalmente desde el CRM.' },
          });
          toast('Consentimiento registrado');
          loadConsentimientos();
        });
      } catch (err) { toast(err.message, 'danger'); }
    }

    document.getElementById('consPacienteSelect').addEventListener('change', e => {
      consPacienteId = e.target.value || null;
      document.getElementById('btnNuevoConsentimiento').disabled = !consPacienteId;
      if (consPacienteId) loadConsentimientos();
      else document.getElementById('consContent').innerHTML = '<div class="list-empty">Selecciona un paciente</div>';
    });

    viewLoaders['consentimientos'] = () => populatePacienteSelects();

  }); // ready
})();
