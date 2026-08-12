/* ═══════════════════════════════════════════════════════
   VHM CRM — part2.js  Dashboard
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fmtMoney, badge, fullName,
            viewLoaders, showLoading,
            ESTADO_CITA, FUENTE_ICON } = window.CRM;

    async function loadDashboard() {
      try {
        showLoading(document.getElementById('kpiGrid'), true);
        const d = await api('/reportes/dashboard');
        showLoading(document.getElementById('kpiGrid'), false);
        const k = d.kpis || {};

        document.getElementById('kpiGrid').innerHTML = `
          <div class="kpi-card accent">
            <div class="kpi-label">Pacientes activos</div>
            <div class="kpi-value">${k.pacientes_activos || 0}</div>
            <div class="kpi-sub">${k.prospectos || 0} prospectos</div>
          </div>
          <div class="kpi-card success">
            <div class="kpi-label">Citas hoy</div>
            <div class="kpi-value">${k.citas_hoy || 0}</div>
            <div class="kpi-sub">${k.citas_semana || 0} esta semana</div>
          </div>
          <div class="kpi-card warning">
            <div class="kpi-label">Leads nuevos</div>
            <div class="kpi-value">${k.leads_nuevos || 0}</div>
          </div>
          <div class="kpi-card info">
            <div class="kpi-label">Ingresos mes</div>
            <div class="kpi-value" style="font-size:1.2rem">${fmtMoney(k.ingresos_mes)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Lista de espera</div>
            <div class="kpi-value">${k.lista_espera || 0}</div>
          </div>`;

        document.getElementById('citasHoyList').innerHTML = (d.citasHoy || []).length
          ? d.citasHoy.map(c => `
            <div class="list-item">
              <div class="list-icon"><i class="fas fa-clock"></i></div>
              <div class="flex-grow-1">
                <div class="list-title">${esc(c.hora_inicio?.slice(0,5))} — ${esc(fullName(c))}</div>
                <div class="list-meta">${esc(c.terapeuta_nombre)} · ${esc(c.modalidad)}</div>
              </div>
              ${badge(c.estado, ESTADO_CITA)}
            </div>`).join('')
          : '<div class="list-empty">Sin citas hoy</div>';

        const leads = await api('/leads?limit=6');
        document.getElementById('leadsRecentesList').innerHTML = (leads || []).length
          ? leads.map(l => `
            <div class="list-item">
              <div class="list-icon"><i class="${FUENTE_ICON[l.fuente] || 'fas fa-circle-dot'}"></i></div>
              <div class="flex-grow-1">
                <div class="list-title">${esc(fullName(l) || 'Sin nombre')}</div>
                <div class="list-meta">${esc(l.fuente_detalle || l.fuente)} · ${fmtDate(l.created_at)}</div>
              </div>
              ${badge(l.estado, window.CRM.ESTADO_LEAD)}
            </div>`).join('')
          : '<div class="list-empty">Sin leads recientes</div>';

      } catch (err) { toast(err.message, 'danger'); }
    }

    viewLoaders['dashboard'] = loadDashboard;

  }); // ready
})();
