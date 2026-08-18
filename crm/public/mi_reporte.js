/* VHM CRM — mi_reporte.js */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, badge, ESTADO_CITA } = window.CRM;
  const terapeutaId = window.__USER_ROL__ === 'terapeuta' ? window.__USER_ID__ : '';

  const COLORS = ['#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#6366f1', '#db2777', '#84cc16'];
  const MODALIDAD_LABEL = { presencial: 'Presencial', videollamada: 'Videollamada', telefono: 'Teléfono' };
  const ACTIVOS = new Set(['pendiente', 'confirmada', 'reagendada']);

  function estadoLabel(estado) {
    return ESTADO_CITA[estado]?.label || estado;
  }

  function modalidadLabel(mod) {
    return MODALIDAD_LABEL[mod] || mod;
  }

  function fmtShortDate(iso) {
    if (!iso) return '—';
    return fmtDate(String(iso).slice(0, 10));
  }

  function daysInRange(desde, hasta) {
    const a = new Date(desde + 'T12:00:00');
    const b = new Date(hasta + 'T12:00:00');
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }

  function sumEstados(estados, keys) {
    return (estados || []).filter(e => keys.includes(e.estado)).reduce((s, e) => s + Number(e.total || 0), 0);
  }

  function barChart(container, rows, { labelKey, valueKey, color = '#7c3aed', fmt = v => v } = {}) {
    if (!rows.length) { container.innerHTML = '<div class="list-empty">Sin datos en este período</div>'; return; }
    const max = Math.max(...rows.map(r => parseFloat(r[valueKey]) || 0), 1);
    container.innerHTML = rows.map(r => {
      const val = parseFloat(r[valueKey]) || 0;
      const pct = Math.max(4, (val / max) * 100);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:110px;font-size:12px;color:var(--text-muted);flex-shrink:0">${esc(String(r[labelKey]))}</div>
        <div style="flex:1;height:24px;background:var(--bg);border-radius:6px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:6px;display:flex;align-items:center;padding:0 8px;font-size:11px;color:#fff;font-weight:600">${fmt(val)}</div>
        </div>
      </div>`;
    }).join('');
  }

  function donutChart(container, rows, { labelFn, valueKey } = {}) {
    if (!rows.length) { container.innerHTML = '<div class="list-empty">Sin datos</div>'; return; }
    const total = rows.reduce((s, r) => s + (parseFloat(r[valueKey]) || 0), 0);
    container.innerHTML = rows.map((r, i) => {
      const val = parseFloat(r[valueKey]) || 0;
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      const label = labelFn ? labelFn(r) : r.estado;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:12px;height:12px;border-radius:3px;background:${COLORS[i % COLORS.length]};flex-shrink:0"></div>
        <div style="flex:1;font-size:13px">${esc(label)}</div>
        <div style="font-size:13px;font-weight:700;min-width:24px;text-align:right">${val}</div>
        <div style="font-size:11px;color:var(--text-muted);width:38px;text-align:right">${pct}%</div>
      </div>`;
    }).join('') + `<div style="font-size:12px;color:var(--text-muted);margin-top:10px;border-top:1px solid var(--border);padding-top:8px">Total registrado: <strong>${total}</strong> citas</div>`;
  }

  function sparkLine(container, rows, { dateKey, valueKey, color = '#7c3aed' } = {}) {
    if (!rows.length) { container.innerHTML = '<div class="list-empty">Sin actividad en este período</div>'; return; }
    const vals = rows.map(r => parseFloat(r[valueKey]) || 0);
    const maxV = Math.max(...vals, 1);
    const total = vals.reduce((a, b) => a + b, 0);
    const avg = (total / vals.length).toFixed(1);
    const peak = Math.max(...vals);
    const W = 100, H = 64;
    const pts = rows.map((r, i) => {
      const x = (i / Math.max(rows.length - 1, 1)) * W;
      const y = H - ((parseFloat(r[valueKey]) || 0) / maxV) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const first = fmtShortDate(rows[0]?.[dateKey]);
    const last  = fmtShortDate(rows[rows.length - 1]?.[dateKey]);
    container.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:12px">
        <span><strong style="color:var(--primary);font-size:18px">${total}</strong> citas totales</span>
        <span style="color:var(--text-muted)">Promedio <strong>${avg}</strong>/día con actividad</span>
        <span style="color:var(--text-muted)">Máximo <strong>${peak}</strong> en un día</span>
      </div>
      <svg viewBox="0 0 100 64" style="width:100%;height:72px;overflow:visible" aria-hidden="true">
        <defs><linearGradient id="mrSparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        <polygon points="${pts} ${W},${H} 0,${H}" fill="url(#mrSparkGrad)" />
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:6px">
        <span>${esc(first)}</span><span>${esc(last)}</span>
      </div>`;
  }

  function renderGauge(container, k, estados) {
    const realizadas = Number(k.citas_realizadas) || 0;
    const noShows    = Number(k.no_shows) || 0;
    const evaluadas  = realizadas + noShows;
    const tasa       = k.tasa_asistencia;
    const pct        = tasa != null ? tasa : 0;
    const activas    = sumEstados(estados, [...ACTIVOS]);

    container.innerHTML = `
      <div class="mr-gauge-ring" style="--pct:${pct}">
        <span class="mr-gauge-val">${tasa != null ? `${tasa}%` : '—'}</span>
      </div>
      <div class="mr-gauge-detail">${realizadas} realizadas · ${noShows} no-show</div>
      <div class="mr-gauge-caption">
        ${evaluadas > 0
          ? `De ${evaluadas} citas con resultado (realizada o no-show), ${realizadas} asistieron.`
          : 'Aún no hay citas cerradas en este período.'}
        ${activas ? `<br>${activas} cita${activas !== 1 ? 's' : ''} aún activa${activas !== 1 ? 's' : ''}.` : ''}
      </div>`;
  }

  function renderSummary(desde, hasta, k, estados) {
    const total      = Number(k.citas_periodo) || 0;
    const realizadas = Number(k.citas_realizadas) || 0;
    const canceladas = Number(k.citas_canceladas) || 0;
    const noShows    = Number(k.no_shows) || 0;
    const activas    = sumEstados(estados, [...ACTIVOS]);
    const dias       = daysInRange(desde, hasta);
    const pctReal    = total > 0 ? Math.round((realizadas / total) * 100) : 0;

    document.getElementById('mrSummary').innerHTML = `
      <div class="card-body">
        <div class="mr-summary-title"><i class="fas fa-calendar-days" style="color:var(--primary);margin-right:6px"></i> Resumen del período</div>
        <div class="mr-summary-text">
          Del <strong>${fmtShortDate(desde)}</strong> al <strong>${fmtShortDate(hasta)}</strong>
          (${dias} día${dias !== 1 ? 's' : ''}) tienes <strong>${total}</strong> cita${total !== 1 ? 's' : ''} programada${total !== 1 ? 's' : ''}
          ${total > 0 ? `, de las cuales <strong>${realizadas}</strong> se realizaron (${pctReal}%).` : '.'}
        </div>
        <div class="mr-summary-stats">
          <span class="mr-summary-pill success"><i class="fas fa-circle-check"></i> ${realizadas} realizadas</span>
          ${activas ? `<span class="mr-summary-pill"><i class="fas fa-hourglass-half"></i> ${activas} activas</span>` : ''}
          ${canceladas ? `<span class="mr-summary-pill warning"><i class="fas fa-ban"></i> ${canceladas} canceladas</span>` : ''}
          ${noShows ? `<span class="mr-summary-pill muted"><i class="fas fa-user-slash"></i> ${noShows} no-show</span>` : ''}
        </div>
      </div>`;
  }

  function setPreset(p) {
    const hoy   = new Date();
    const fmt   = d => d.toISOString().slice(0, 10);
    const desde = document.getElementById('mrDesde');
    const hasta = document.getElementById('mrHasta');
    hasta.value = fmt(hoy);
    if (p === 'hoy')    { desde.value = fmt(hoy); }
    if (p === 'semana') { const d = new Date(hoy); d.setDate(hoy.getDate() - 6); desde.value = fmt(d); }
    if (p === 'mes')    { desde.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`; }
    if (p === 'mes3')   { const d = new Date(hoy); d.setMonth(hoy.getMonth() - 3); desde.value = fmt(d); }
  }

  async function loadReporte() {
    try {
      const desde = document.getElementById('mrDesde').value;
      const hasta = document.getElementById('mrHasta').value;
      if (!desde || !hasta) { toast('Selecciona un rango de fechas', 'danger'); return; }
      if (desde > hasta) { toast('La fecha inicial no puede ser posterior a la final', 'danger'); return; }

      const qs = new URLSearchParams({ desde, hasta });
      if (terapeutaId) qs.set('terapeuta_id', terapeutaId);

      const d = await api(`/reportes/stats?${qs}`);
      const k = d.kpis || {};
      const estados = d.citasPorEstado || [];
      const activas = sumEstados(estados, [...ACTIVOS]);
      const totalAll = estados.reduce((s, e) => s + Number(e.total || 0), 0);

      renderSummary(desde, hasta, k, estados);

      document.getElementById('mrKpis').innerHTML = [
        {
          label: 'Citas programadas',
          value: k.citas_periodo || 0,
          sub: 'Sin canceladas ni no-show',
          css: 'accent',
        },
        {
          label: 'Realizadas',
          value: k.citas_realizadas || 0,
          sub: k.citas_periodo ? `${Math.round(((k.citas_realizadas || 0) / k.citas_periodo) * 100)}% del programado` : '—',
          css: 'success',
        },
        {
          label: 'Activas / pendientes',
          value: activas,
          sub: 'Pendiente, confirmada o reagendada',
          css: 'info',
        },
        {
          label: 'Tasa de asistencia',
          value: k.tasa_asistencia != null ? `${k.tasa_asistencia}%` : '—',
          sub: `${k.citas_realizadas || 0} de ${(k.citas_realizadas || 0) + (k.no_shows || 0)} con resultado`,
          css: 'success',
        },
        {
          label: 'Canceladas',
          value: k.citas_canceladas || 0,
          sub: totalAll ? `${Math.round(((k.citas_canceladas || 0) / totalAll) * 100)}% del total` : '—',
          css: 'warning',
        },
        {
          label: 'No se presentaron',
          value: k.no_shows || 0,
          sub: 'Ausencias registradas',
          css: '',
        },
      ].map(c => `
        <div class="kpi-card ${c.css}">
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-value">${c.value}</div>
          ${c.sub ? `<div class="kpi-sub">${c.sub}</div>` : ''}
        </div>`).join('');

      sparkLine(document.getElementById('mrSparkCitas'), d.citasPorDia || [], {
        dateKey: 'fecha', valueKey: 'total', color: '#7c3aed',
      });

      donutChart(document.getElementById('mrDonutEstado'), estados, {
        labelFn: r => estadoLabel(r.estado),
        valueKey: 'total',
      });

      barChart(
        document.getElementById('mrBarModalidad'),
        (d.citasPorModalidad || []).map(r => ({ ...r, label: modalidadLabel(r.modalidad) })),
        { labelKey: 'label', valueKey: 'total', color: '#0891b2', fmt: v => `${v} ses.` }
      );

      renderGauge(document.getElementById('mrGauge'), k, estados);

      const citasQs = new URLSearchParams({ desde, hasta });
      if (terapeutaId) citasQs.set('terapeuta_id', terapeutaId);
      const citas = await api(`/citas?${citasQs}`);

      document.getElementById('mrDetalle').innerHTML = citas.length
        ? `<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${citas.length} cita${citas.length !== 1 ? 's' : ''} en el detalle</p>
          <div class="table-scroll"><table class="table" style="font-size:12px">
            <thead><tr><th>Fecha</th><th>Paciente</th><th>Modalidad</th><th>Estado</th></tr></thead>
            <tbody>${citas.map(c => `<tr>
              <td>${fmtShortDate(c.fecha)}</td>
              <td>${esc(`${c.paciente_nombre || ''} ${c.paciente_apellido || ''}`.trim())}</td>
              <td>${esc(modalidadLabel(c.modalidad))}</td>
              <td>${badge(c.estado, ESTADO_CITA)}</td>
            </tr>`).join('')}</tbody>
          </table></div>`
        : '<div class="list-empty">Sin citas en este período</div>';

    } catch (err) { toast(err.message, 'danger'); }
  }

  document.querySelectorAll('[data-mr-preset]').forEach(btn =>
    btn.addEventListener('click', () => { setPreset(btn.dataset.mrPreset); loadReporte(); })
  );
  document.getElementById('btnAplicarMr').addEventListener('click', loadReporte);
  ['mrDesde', 'mrHasta'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') loadReporte(); })
  );

  setPreset('mes');
  loadReporte();

})();
