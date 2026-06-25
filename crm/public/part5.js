/* ═══════════════════════════════════════════════════════
   VHM CRM — part5.js  Reportes enriquecidos
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fmtMoney, viewLoaders, isAdmin } = window.CRM;

    // ── Utilidades de gráficos ────────────────────────────────
    const COLORS = [
      '#7c3aed','#4f46e5','#0891b2','#16a34a','#d97706',
      '#dc2626','#db2777','#6366f1','#0ea5e9','#84cc16',
    ];

    function barChart(container, rows, { labelKey, valueKey, color = '#7c3aed', fmt = (v) => v } = {}) {
      if (!rows.length) { container.innerHTML = '<div class="list-empty">Sin datos en este período</div>'; return; }
      const max = Math.max(...rows.map(r => parseFloat(r[valueKey]) || 0), 1);
      container.innerHTML = rows.map(r => {
        const val = parseFloat(r[valueKey]) || 0;
        const pct = Math.max(4, (val / max) * 100);
        return `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="width:100px;font-size:12px;color:var(--text-muted);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(String(r[labelKey]))}">${esc(String(r[labelKey]))}</div>
            <div style="flex:1;height:22px;background:var(--bg);border-radius:4px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;display:flex;align-items:center;padding:0 6px;font-size:11px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden">${fmt(val)}</div>
            </div>
          </div>`;
      }).join('');
    }

    function donutChart(container, rows, { labelKey, valueKey } = {}) {
      if (!rows.length) { container.innerHTML = '<div class="list-empty">Sin datos</div>'; return; }
      const total = rows.reduce((s, r) => s + (parseFloat(r[valueKey]) || 0), 0);
      container.innerHTML = rows.map((r, i) => {
        const val = parseFloat(r[valueKey]) || 0;
        const pct = total > 0 ? Math.round((val / total) * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
            <div style="width:12px;height:12px;border-radius:3px;background:${COLORS[i % COLORS.length]};flex-shrink:0"></div>
            <div style="flex:1;font-size:13px;color:var(--text)">${esc(String(r[labelKey]))}</div>
            <div style="font-size:13px;font-weight:600">${val}</div>
            <div style="font-size:11px;color:var(--text-muted);width:34px;text-align:right">${pct}%</div>
          </div>`;
      }).join('') + `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;border-top:1px solid var(--border);padding-top:6px">Total: <strong>${total}</strong></div>`;
    }

    function sparkLine(container, rows, { dateKey, valueKey, color = '#7c3aed', fmt = (v) => v } = {}) {
      if (!rows.length) { container.innerHTML = '<div class="list-empty">Sin datos en este período</div>'; return; }
      const vals = rows.map(r => parseFloat(r[valueKey]) || 0);
      const maxV = Math.max(...vals, 1);
      const W = 100, H = 60;
      const pts = rows.map((r, i) => {
        const x = (i / Math.max(rows.length - 1, 1)) * W;
        const y = H - ((parseFloat(r[valueKey]) || 0) / maxV) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const total = vals.reduce((a, b) => a + b, 0);
      container.innerHTML = `
        <div style="margin-bottom:8px;font-size:13px;font-weight:700;color:var(--text)">${fmt(total)} <span style="font-size:11px;color:var(--text-muted);font-weight:400">total en el período</span></div>
        <svg viewBox="0 0 100 60" style="width:100%;height:60px;overflow:visible">
          <defs><linearGradient id="sg${color.replace('#','')}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <polygon points="${pts} ${W},${H} 0,${H}" fill="url(#sg${color.replace('#','')})" />
          <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-top:4px">
          <span>${esc(rows[0]?.[dateKey] || '')}</span>
          <span>${esc(rows[rows.length-1]?.[dateKey] || '')}</span>
        </div>`;
    }

    // ── Fechas por defecto: hoy ───────────────────────────────
    function todayStr() { return new Date().toISOString().slice(0, 10); }

    function setPreset(preset) {
      const hoy = new Date();
      const fmt = d => d.toISOString().slice(0, 10);
      let desde, hasta = fmt(hoy);
      if (preset === 'hoy')   { desde = fmt(hoy); }
      if (preset === 'semana') {
        const d = new Date(hoy);
        d.setDate(hoy.getDate() - hoy.getDay() + (hoy.getDay() === 0 ? -6 : 1));
        desde = fmt(d);
      }
      if (preset === 'mes')  {
        desde = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
      }
      if (preset === 'mes3') {
        const d = new Date(hoy); d.setMonth(d.getMonth() - 3);
        desde = fmt(d);
      }
      document.getElementById('rptDesde').value = desde;
      document.getElementById('rptHasta').value = hasta;
    }

    // ── Cargar reportes ───────────────────────────────────────
    async function loadReportes() {
      if (!isAdmin()) return;
      const desde = document.getElementById('rptDesde').value || todayStr();
      const hasta = document.getElementById('rptHasta').value || todayStr();

      try {
        const d = await api(`/reportes/stats?desde=${desde}&hasta=${hasta}`);
        const k = d.kpis || {};

        // ── KPIs ─────────────────────────────────────────────
        document.getElementById('reporteKpis').innerHTML = `
          <div class="kpi-card accent">
            <div class="kpi-label">Ingresos</div>
            <div class="kpi-value" style="font-size:1.3rem">${fmtMoney(k.ingresos)}</div>
            <div class="kpi-sub">S/ ${k.ingreso_promedio_cita || 0} / cita</div>
          </div>
          <div class="kpi-card success">
            <div class="kpi-label">Citas realizadas</div>
            <div class="kpi-value">${k.citas_realizadas || 0}</div>
            <div class="kpi-sub">de ${k.citas_periodo || 0} programadas</div>
          </div>
          <div class="kpi-card" style="border-left:3px solid var(--primary)">
            <div class="kpi-label">Tasa asistencia</div>
            <div class="kpi-value">${k.tasa_asistencia !== null ? k.tasa_asistencia + '%' : '—'}</div>
            <div class="kpi-sub">${k.no_shows || 0} no-shows</div>
          </div>
          <div class="kpi-card warning">
            <div class="kpi-label">Leads captados</div>
            <div class="kpi-value">${k.leads_periodo || 0}</div>
            <div class="kpi-sub">${k.leads_convertidos || 0} convertidos (${k.tasa_conversion_leads !== null ? k.tasa_conversion_leads + '%' : '—'})</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Pacientes nuevos</div>
            <div class="kpi-value">${k.pacientes_nuevos || 0}</div>
            <div class="kpi-sub">${k.pacientes_activos || 0} activos en total</div>
          </div>
          <div class="kpi-card" style="border-left:3px solid var(--danger)">
            <div class="kpi-label">Cancelaciones</div>
            <div class="kpi-value">${k.citas_canceladas || 0}</div>
          </div>`;

        // ── Citas por día ─────────────────────────────────────
        sparkLine(
          document.getElementById('grafCitasDia'),
          d.citasPorDia || [],
          { dateKey: 'fecha', valueKey: 'total', color: '#7c3aed' }
        );

        // ── Leads por fuente ──────────────────────────────────
        const grafLeads = document.getElementById('grafLeadsFuente');
        if ((d.leadsPorFuente || []).length) {
          grafLeads.innerHTML = (d.leadsPorFuente).map((f, i) => {
            const total = f.total;
            const conv  = f.convertidos;
            const pctConv = total > 0 ? Math.round((conv / total) * 100) : 0;
            const maxT = Math.max(...d.leadsPorFuente.map(x => x.total), 1);
            const pctBar = Math.max(4, (total / maxT) * 100);
            return `
              <div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                  <span style="font-weight:600">${esc(f.fuente)}</span>
                  <span style="color:var(--text-muted)">${total} leads · <span style="color:var(--success)">${conv} convertidos (${pctConv}%)</span></span>
                </div>
                <div style="height:10px;background:var(--bg);border-radius:4px;overflow:hidden">
                  <div style="width:${pctBar}%;height:100%;background:${COLORS[i % COLORS.length]};border-radius:4px"></div>
                </div>
              </div>`;
          }).join('');
        } else {
          grafLeads.innerHTML = '<div class="list-empty">Sin leads en este período</div>';
        }

        // ── Ingresos por día ──────────────────────────────────
        sparkLine(
          document.getElementById('grafIngresosDia'),
          d.ingresosPorDia || [],
          { dateKey: 'dia', valueKey: 'total', color: '#16a34a', fmt: v => fmtMoney(v) }
        );

        // ── Método de pago ────────────────────────────────────
        const grafMetodo = document.getElementById('grafMetodoPago');
        if ((d.ingresosPorMetodo || []).length) {
          donutChart(grafMetodo, d.ingresosPorMetodo, { labelKey: 'metodo', valueKey: 'cantidad' });
          grafMetodo.innerHTML += `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">` +
            d.ingresosPorMetodo.map((m, i) =>
              `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
                 <span style="color:${COLORS[i % COLORS.length]};font-weight:600">${esc(m.metodo)}</span>
                 <span>${fmtMoney(m.total)}</span>
               </div>`
            ).join('') + `</div>`;
        } else {
          grafMetodo.innerHTML = '<div class="list-empty">Sin pagos</div>';
        }

        // ── Por terapeuta ─────────────────────────────────────
        barChart(
          document.getElementById('grafTerapeuta'),
          (d.citasPorTerapeuta || []).map(t => ({
            ...t,
            nombre_corto: t.nombre + (t.apellido ? ' ' + t.apellido[0] + '.' : ''),
          })),
          { labelKey: 'nombre_corto', valueKey: 'total', color: '#7c3aed' }
        );

        // ── Por estado ────────────────────────────────────────
        donutChart(
          document.getElementById('grafEstadoCita'),
          d.citasPorEstado || [],
          { labelKey: 'estado', valueKey: 'total' }
        );

        // ── Modalidad ─────────────────────────────────────────
        donutChart(
          document.getElementById('grafModalidad'),
          d.citasPorModalidad || [],
          { labelKey: 'modalidad', valueKey: 'total' }
        );

        // ── Acciones ──────────────────────────────────────────
        document.getElementById('rptAcciones').innerHTML = `
          <button class="btn btn-outline btn-sm" id="btnProcesarRec">
            <i class="fas fa-bell"></i> Procesar recordatorios
          </button>
          <button class="btn btn-outline btn-sm" id="btnFollowUp">
            <i class="fas fa-envelope"></i> Follow-up inactivos
          </button>`;

        document.getElementById('btnProcesarRec')?.addEventListener('click', async () => {
          try {
            const r = await api('/reportes/procesar-recordatorios', { method: 'POST' });
            toast(`${r.enviados} recordatorios enviados`);
          } catch (err) { toast(err.message, 'danger'); }
        });
        document.getElementById('btnFollowUp')?.addEventListener('click', async () => {
          try {
            const r = await api('/reportes/followup-inactivos', { method: 'POST' });
            toast(`${r.enviados} follow-ups enviados`);
          } catch (err) { toast(err.message, 'danger'); }
        });

      } catch (err) { toast(err.message, 'danger'); }
    }

    // ── Event listeners filtros ───────────────────────────────
    document.querySelectorAll('[data-rpt-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        setPreset(btn.dataset.rptPreset);
        loadReportes();
      });
    });

    document.getElementById('btnAplicarFiltro')?.addEventListener('click', loadReportes);

    // Enter en los inputs de fecha también aplica
    ['rptDesde','rptHasta'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') loadReportes();
      });
    });

    viewLoaders['reportes'] = () => {
      // Por defecto: hoy
      if (!document.getElementById('rptDesde').value) setPreset('hoy');
      loadReportes();
    };

  }); // ready
})();
