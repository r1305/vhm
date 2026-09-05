/* VHM — agendar.js (página pública de agendamiento) */
(function () {
  'use strict';

  const BASE     = window.__APP_BASE__ || '';
  const USERNAME = window.__TER_USERNAME__;
  const MESES    = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS     = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let cursor = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  let slotsData = []; // dias con slots del mes actual
  let fechaSel  = null;
  let horaSel   = null;

  // ── API helper ──────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.codigo = data.codigo || null;
      throw err;
    }
    return data;
  }

  // ── Cargar slots del mes ────────────────────────────────────────
  async function loadMes() {
    const mes = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`;
    document.getElementById('agMesTitulo').textContent = `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    document.getElementById('agCal').innerHTML = '<div class="ag-loading"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
      const data = await api(`/api/publico/${USERNAME}/slots?mes=${mes}`);
      slotsData = data.dias;
      renderCal();
    } catch (e) {
      document.getElementById('agCal').innerHTML = `<div class="ag-error">${e.message}</div>`;
    }
  }

  // ── Render calendario mes ───────────────────────────────────────
  function renderCal() {
    const anio = cursor.getFullYear();
    const mes  = cursor.getMonth();
    const ini  = new Date(anio, mes, 1);
    const fin  = new Date(anio, mes+1, 0);

    // Mapa fecha -> slots
    const mapa = {};
    slotsData.forEach(d => { mapa[d.fecha] = d.slots; });

    let html = `<table class="ag-table"><thead><tr>`;
    DIAS.forEach(d => { html += `<th>${d}</th>`; });
    html += `</tr></thead><tbody>`;

    let dia = new Date(anio, mes, 1 - ini.getDay());
    while (dia <= fin || dia.getDay() !== 0) {
      if (dia.getDay() === 0) html += '<tr>';
      const f = isoDate(dia);
      const esMes = dia.getMonth() === mes;
      const esHoy = dia.getTime() === hoy.getTime();
      const slots = mapa[f] || [];
      const libre = esMes && slots.length > 0;
      const sel   = f === fechaSel;

      html += `<td class="${!esMes?'ag-otro':''}${esHoy?' ag-hoy':''}${libre?' ag-libre':''}${sel?' ag-sel':''}"
        ${libre ? `data-fecha="${f}"` : ''}>
        <span class="ag-num">${dia.getDate()}</span>
        ${libre ? `<span class="ag-slots-count">${slots.length}</span>` : ''}
      </td>`;
      if (dia.getDay() === 6) html += '</tr>';
      dia.setDate(dia.getDate()+1);
    }
    html += `</tbody></table>`;
    document.getElementById('agCal').innerHTML = html;

    document.querySelectorAll('[data-fecha]').forEach(td => {
      td.addEventListener('click', () => seleccionarFecha(td.dataset.fecha));
    });
  }

  // ── Seleccionar fecha → step 2 ──────────────────────────────────
  function seleccionarFecha(f) {
    fechaSel = f;
    const dia = slotsData.find(d => d.fecha === f);
    if (!dia || !dia.slots.length) return;

    const [y,m,d] = f.split('-').map(Number);
    const fecha = new Date(y, m-1, d);
    document.getElementById('agFechaSel').textContent =
      `${DIAS[fecha.getDay()]} ${d} de ${MESES[m-1]} ${y}`;

    document.getElementById('agSlots').innerHTML = dia.slots.map(h => {
      const [hh] = h.split(':').map(Number);
      const hfin = `${String(hh+1).padStart(2,'0')}:${h.slice(3)}`;
      return `<button class="ag-slot" data-hora="${h}">${h} – ${hfin}</button>`;
    }).join('');

    document.querySelectorAll('.ag-slot').forEach(btn => {
      btn.addEventListener('click', () => seleccionarHora(btn.dataset.hora));
    });

    goStep(2);
  }

  // ── Seleccionar hora → step 3 ───────────────────────────────────
  function seleccionarHora(h) {
    horaSel = h;
    document.querySelectorAll('.ag-slot').forEach(b => b.classList.toggle('ag-slot-sel', b.dataset.hora === h));

    const [y,m,d] = fechaSel.split('-').map(Number);
    const [hh] = h.split(':').map(Number);
    const hfin = `${String(hh+1).padStart(2,'0')}:${h.slice(3)}`;
    document.getElementById('agResumen').innerHTML =
      `<i class="fas fa-calendar-check"></i>
       <strong>${DIAS[new Date(y,m-1,d).getDay()]} ${d} de ${MESES[m-1]}</strong>
       &nbsp;·&nbsp; ${h} – ${hfin}`;

    goStep(3);
  }

  // ── Confirmar cita ──────────────────────────────────────────────
  document.getElementById('agConfirmar').addEventListener('click', async () => {
    const nombre   = document.getElementById('ag_nombre').value.trim();
    const apellido = document.getElementById('ag_apellido').value.trim();
    const telefono = document.getElementById('ag_telefono').value.trim();
    const email    = document.getElementById('ag_email').value.trim();
    const motivo   = document.getElementById('ag_motivo').value.trim();
    const errEl    = document.getElementById('agErrorMsg');

    if (!nombre) { mostrarError('El nombre es obligatorio'); return; }
    if (!telefono) { mostrarError('El teléfono es obligatorio'); return; }

    errEl.style.display = 'none';
    const btn = document.getElementById('agConfirmar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirmando…';

    try {
      await api(`/api/publico/${USERNAME}/agendar`, {
        method: 'POST',
        body: { nombre, apellido, email, telefono, motivo, fecha: fechaSel, hora_inicio: horaSel },
      });

      const [y,m,d] = fechaSel.split('-').map(Number);
      const [hh] = horaSel.split(':').map(Number);
      const hfin = `${String(hh+1).padStart(2,'0')}:${horaSel.slice(3)}`;
      document.getElementById('agExitoDetalle').innerHTML =
        `<strong>${DIAS[new Date(y,m-1,d).getDay()]} ${d} de ${MESES[m-1]} ${y}</strong><br>
         ${horaSel} – ${hfin}<br>
         con ${window.__TER_NOMBRE__}`;

      goStep(4);
    } catch (e) {
      mostrarError(e.message, e.codigo === 'SIN_SESIONES');
      btn.disabled = false;
      btn.innerHTML = 'Confirmar cita';
    }
  });

  function mostrarError(msg, esSinSesiones = false) {
    const el = document.getElementById('agErrorMsg');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.className = 'ag-error-msg' + (esSinSesiones ? ' ag-error-sesiones' : '');
    el.style.display = 'block';
  }

  // ── Navegación entre steps ──────────────────────────────────────
  function goStep(n) {
    document.querySelectorAll('.ag-step').forEach((el, i) => {
      el.classList.toggle('active', i+1 === n);
    });
    window.scrollTo(0, 0);
  }

  document.getElementById('agBackToStep1').addEventListener('click', () => { goStep(1); renderCal(); });
  document.getElementById('agBackToStep2').addEventListener('click', () => goStep(2));
  document.getElementById('agNuevaCita').addEventListener('click', () => {
    fechaSel = null; horaSel = null;
    document.getElementById('ag_nombre').value = '';
    document.getElementById('ag_apellido').value = '';
    document.getElementById('ag_telefono').value = '';
    document.getElementById('ag_email').value = '';
    document.getElementById('ag_motivo').value = '';
    goStep(1);
    loadMes();
  });

  // ── Navegación mes ──────────────────────────────────────────────
  document.getElementById('agPrev').addEventListener('click', () => {
    // No permitir ir a meses anteriores al actual
    const mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    if (cursor <= mesActual) return;
    cursor.setMonth(cursor.getMonth()-1);
    loadMes();
  });
  document.getElementById('agNext').addEventListener('click', () => {
    cursor.setMonth(cursor.getMonth()+1);
    loadMes();
  });

  // ── Init ────────────────────────────────────────────────────────
  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  loadMes();
})();
