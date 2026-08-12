/* ═══════════════════════════════════════════════════════
   VHM CRM — consent.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fullName, viewLoaders } = window.CRM;

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

    viewLoaders['consentimientos'] = () => window.CRM.populatePacienteSelects?.();

  }); // ready
})();
