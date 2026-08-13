/* VHM CRM — dashboard.js */
(function () {
  'use strict';
  const { api, toast, esc, fmtDate, fmtMoney, badge, fullName, ESTADO_LEAD, FUENTE_ICON } = window.CRM;

  async function refreshLeads() {
    try {
      const leads = await api('/leads?limit=6');
      document.getElementById('leadsRecentesList').innerHTML = (leads || []).length
        ? leads.map(l => `
          <div class="list-item">
            <div class="list-icon"><i class="${FUENTE_ICON[l.fuente] || 'fas fa-circle-dot'}"></i></div>
            <div style="flex:1">
              <div class="list-title">${esc(fullName(l) || 'Sin nombre')}</div>
              <div class="list-meta">${esc(l.fuente_detalle || l.fuente)} · ${fmtDate(l.created_at)}</div>
            </div>
            ${badge(l.estado, ESTADO_LEAD)}
          </div>`).join('')
        : '<div class="list-empty">Sin leads recientes</div>';
    } catch (_) {}
  }

  refreshLeads();
})();
