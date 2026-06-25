/* ═══════════════════════════════════════════════════════
   VHM CRM — part5.js  Reportes
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fmtMoney, badge,
            viewLoaders, ESTADO_CITA, isAdmin } = window.CRM;

    async function loadReportes() {
      if (!isAdmin()) return;
      try {
        const d = await api('/reportes/dashboard');
        const k = d.kpis || {};

        document.getElementById('reporteKpis').innerHTML = `
          <div class="kpi-card accent">
            <div class="kpi-label">Pacientes activos</div>
            <div class="kpi-value">${k.pacientes_activos || 0}</div>
            <div class="kpi-sub">${k.prospectos || 0} prospectos</div>
          </div>
          <div class="kpi-card success">
            <div class="kpi-label">Citas hoy</div>
            <div class="kpi-value">${k.citas_hoy || 0}</div>
          </div>
          <div class="kpi-card warning">
            <div class="kpi-label">Leads nuevos</div>
            <div class="kpi-value">${k.leads_nuevos || 0}</div>
          </div>
          <div class="kpi-card info">
            <div class="kpi-label">Ingresos mes</div>
            <div class="kpi-value" style="font-size:1.15rem">${fmtMoney(k.ingresos_mes)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Lista espera</div>
            <div class="kpi-value">${k.lista_espera || 0}</div>
          </div>`;

        // Leads por fuente
        const fuentes = d.leadsFuente || [];
        document.getElementById('reporteLeadsFuente').innerHTML = fuentes.length
          ? fuentes.map(f => {
              const pct = Math.round((f.total / (fuentes.reduce((a, x) => a + x.total, 0) || 1)) * 100);
              return `
                <div style="padding:10px 16px;border-bottom:1px solid var(--border)">
                  <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                    <strong>${esc(f.fuente)}</strong>
                    <span>${f.total} leads</span>
                  </div>
                  <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:var(--primary);border-radius:3px;transition:width .4s"></div>
                  </div>
                </div>`;
            }).join('')
          : '<div class="list-empty">Sin datos de fuentes</div>';

        // Citas de hoy
        document.getElementById('reporteCitasHoy').innerHTML = (d.citasHoy || []).length
          ? d.citasHoy.map(c => `
            <div class="list-item">
              <div style="font-weight:700;color:var(--primary);width:50px;flex-shrink:0">${esc(c.hora_inicio?.slice(0,5))}</div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${esc(c.paciente_nombre||'')} ${esc(c.paciente_apellido||'')}</div>
                <div style="font-size:11px;color:var(--text-muted)">${esc(c.terapeuta_nombre)} · ${esc(c.modalidad)}</div>
              </div>
              ${badge(c.estado, ESTADO_CITA)}
            </div>`).join('')
          : '<div class="list-empty">Sin citas hoy</div>';

        // Botón procesar recordatorios
        if (!document.getElementById('btnProcesarRecordatorios')) {
          const btn = document.createElement('button');
          btn.id = 'btnProcesarRecordatorios';
          btn.className = 'btn btn-outline btn-sm';
          btn.style.marginTop = '16px';
          btn.innerHTML = '<i class="fas fa-bell"></i> Procesar recordatorios pendientes';
          btn.addEventListener('click', async () => {
            try {
              const r = await api('/reportes/procesar-recordatorios', { method: 'POST' });
              toast(`${r.enviados} recordatorios enviados`);
            } catch (err) { toast(err.message, 'danger'); }
          });
          document.getElementById('view-reportes').appendChild(btn);

          const btn2 = document.createElement('button');
          btn2.className = 'btn btn-outline btn-sm';
          btn2.style.marginTop = '8px';
          btn2.style.marginLeft = '8px';
          btn2.innerHTML = '<i class="fas fa-envelope"></i> Follow-up pacientes inactivos';
          btn2.addEventListener('click', async () => {
            try {
              const r = await api('/reportes/followup-inactivos', { method: 'POST' });
              toast(`${r.enviados} follow-ups enviados`);
            } catch (err) { toast(err.message, 'danger'); }
          });
          document.getElementById('view-reportes').appendChild(btn2);
        }
      } catch (err) { toast(err.message, 'danger'); }
    }

    viewLoaders['reportes'] = loadReportes;

  }); // ready
})();
