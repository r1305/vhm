/* VHM CRM — mi_reporte.js */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, badge, ESTADO_CITA } = window.CRM;
  const terapeutaId = window.__USER_ROL__ === 'terapeuta' ? window.__USER_ID__ : '';

  function setPreset(p) {
    const hoy   = new Date();
    const fmt   = d => d.toISOString().slice(0, 10);
    const desde = document.getElementById('mrDesde');
    const hasta = document.getElementById('mrHasta');
    hasta.value = fmt(hoy);
    if (p === 'hoy')   { desde.value = fmt(hoy); }
    if (p === 'semana') { const d = new Date(hoy); d.setDate(hoy.getDate() - 6);  desde.value = fmt(d); }
    if (p === 'mes')    { const d = new Date(hoy); d.setDate(1);                   desde.value = fmt(d); }
    if (p === 'mes3')   { const d = new Date(hoy); d.setMonth(hoy.getMonth() - 3); desde.value = fmt(d); }
  }

  async function loadReporte() {
    try {
      const desde = document.getElementById('mrDesde').value;
      const hasta = document.getElementById('mrHasta').value;
      const qs    = new URLSearchParams({ desde, hasta });
      if (terapeutaId) qs.set('terapeuta_id', terapeutaId);

      const d = await api(`/reportes/stats?${qs}`);
      const k = d.kpis || {};

      document.getElementById('mrKpis').innerHTML = [
        { label: 'Citas en período',   value: k.citas_periodo   || 0, css: 'accent'  },
        { label: 'Realizadas',         value: k.citas_realizadas || 0, css: 'success' },
        { label: 'Canceladas',         value: k.citas_canceladas || 0, css: 'warning' },
        { label: 'No se presentaron',  value: k.no_shows         || 0, css: ''        },
        { label: 'Tasa de asistencia', value: k.tasa_asistencia != null ? `${k.tasa_asistencia}%` : '—', css: 'success' },
      ].map(c => `
        <div class="kpi-card ${c.css}">
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-value">${c.value}</div>
        </div>`).join('');

      // Citas por día
      const dias = d.citasPorDia || [];
      document.getElementById('mrCitasDia').innerHTML = dias.length
        ? `<table class="table" style="font-size:12px">
            <thead><tr><th>Fecha</th><th>Citas</th><th>Barra</th></tr></thead>
            <tbody>${dias.map(r => {
              const max  = Math.max(...dias.map(x => x.total), 1);
              const pct  = Math.round((r.total / max) * 100);
              const fecha = String(r.fecha).slice(0, 10);
              return `<tr>
                <td>${fmtDate(fecha)}</td>
                <td><strong>${r.total}</strong></td>
                <td style="width:120px"><div style="background:var(--primary);height:8px;border-radius:4px;width:${pct}%"></div></td>
              </tr>`;
            }).join('')}</tbody>
          </table>`
        : '<div class="list-empty">Sin datos</div>';

      // Por estado
      const estados = d.citasPorEstado || [];
      document.getElementById('mrEstados').innerHTML = estados.length
        ? estados.map(e => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
              ${badge(e.estado, ESTADO_CITA)}
              <strong>${e.total}</strong>
            </div>`).join('')
        : '<div class="list-empty">Sin datos</div>';

      // Detalle de citas
      const citas = await api(`/citas?desde=${desde}&hasta=${hasta}${terapeutaId ? `&terapeuta_id=${terapeutaId}` : ''}&mes=${desde.slice(0,7)}`);
      document.getElementById('mrDetalle').innerHTML = (citas || []).length
        ? `<table class="table" style="font-size:12px">
            <thead><tr><th>Fecha</th><th>Paciente</th><th>Modalidad</th><th>Estado</th></tr></thead>
            <tbody>${citas.map(c => `<tr>
              <td>${fmtDate(String(c.fecha).slice(0,10))}</td>
              <td>${esc((c.paciente_nombre||'')+' '+(c.paciente_apellido||''))}</td>
              <td>${esc(c.modalidad||'—')}</td>
              <td>${badge(c.estado, ESTADO_CITA)}</td>
            </tr>`).join('')}</tbody>
          </table>`
        : '<div class="list-empty">Sin citas en este período</div>';

    } catch (err) { toast(err.message, 'danger'); }
  }

  document.querySelectorAll('[data-mr-preset]').forEach(btn =>
    btn.addEventListener('click', () => { setPreset(btn.dataset.mrPreset); loadReporte(); })
  );
  document.getElementById('btnAplicarMr').addEventListener('click', loadReporte);

  setPreset('mes');
  loadReporte();

})();
