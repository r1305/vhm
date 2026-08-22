/* VHM CRM — disponibilidad.js */
(function () {
  'use strict';

  const { api, toast } = window.CRM;
  const BASE = window.__APP_BASE__ || '';

  const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  const selTer = document.getElementById('selTerapeuta');
  // Si no hay selector (terapeuta viendo su propia disp), usar __USER_ID__
  function getTerId() {
    return selTer ? parseInt(selTer.value) : window.__USER_ID__;
  }

  let dispActual = []; // filas actuales en BD
  let username   = '';

  async function load() {
    const tid = getTerId();
    try {
      dispActual = await api(`/terapeutas/${tid}/disponibilidad`);
      // Obtener username para el link
      const ters = await api('/terapeutas');
      const ter  = ters.find(t => t.id === tid);
      username   = ter?.username || '';
      render();
      updateLink();
    } catch (e) { toast(e.message, 'danger'); }
  }

  function render() {
    const mapa = {};
    dispActual.forEach(d => { mapa[d.dia_semana] = d; });

    const html = DIAS.map((nombre, i) => {
      const d  = mapa[i];
      const hi = d ? String(d.hora_inicio).slice(0,5) : '09:00';
      const hf = d ? String(d.hora_fin).slice(0,5)   : '18:00';
      return `
        <div class="disp-row ${d ? 'disp-activo' : ''}">
          <div class="disp-check">
            <input type="checkbox" id="dia_${i}" ${d ? 'checked' : ''}>
            <label for="dia_${i}">${nombre}</label>
          </div>
          <div class="disp-horas ${d ? '' : 'disp-horas-disabled'}">
            <input type="time" id="hi_${i}" value="${hi}" class="form-control" ${d ? '' : 'disabled'}>
            <span>a</span>
            <input type="time" id="hf_${i}" value="${hf}" class="form-control" ${d ? '' : 'disabled'}>
          </div>
        </div>`;
    }).join('');

    document.getElementById('dispGrid').innerHTML = `
      <div class="disp-grid">${html}</div>
      <div style="margin-top:16px">
        <button class="btn btn-primary" id="btnGuardarDisp"><i class="fas fa-save"></i> Guardar horario</button>
      </div>`;

    // Toggle horas al marcar/desmarcar día
    DIAS.forEach((_, i) => {
      document.getElementById(`dia_${i}`).addEventListener('change', e => {
        const horas = document.getElementById(`hi_${i}`).closest('.disp-horas');
        horas.classList.toggle('disp-horas-disabled', !e.target.checked);
        document.getElementById(`hi_${i}`).disabled = !e.target.checked;
        document.getElementById(`hf_${i}`).disabled = !e.target.checked;
        document.getElementById(`dia_${i}`).closest('.disp-row').classList.toggle('disp-activo', e.target.checked);
      });
    });

    document.getElementById('btnGuardarDisp').addEventListener('click', guardar);
  }

  async function guardar() {
    const tid = getTerId();
    const btn = document.getElementById('btnGuardarDisp');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    try {
      // Eliminar todas las filas actuales
      for (const d of dispActual) {
        await api(`/terapeutas/${tid}/disponibilidad/${d.id}`, { method: 'DELETE' });
      }
      // Insertar las activas
      for (let i = 0; i < 7; i++) {
        if (!document.getElementById(`dia_${i}`)?.checked) continue;
        const hi = document.getElementById(`hi_${i}`).value;
        const hf = document.getElementById(`hf_${i}`).value;
        if (!hi || !hf || hf <= hi) { toast(`Horario inválido para ${DIAS[i]}`, 'danger'); continue; }
        await api(`/terapeutas/${tid}/disponibilidad`, {
          method: 'POST', body: { dia_semana: i, hora_inicio: hi, hora_fin: hf },
        });
      }
      toast('Horario guardado');
      await load();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Guardar horario';
    }
  }

  function updateLink() {
    const link = `${location.origin}${BASE}/agendar/${username}`;
    const el   = document.getElementById('dispLink');
    const btn  = document.getElementById('btnOpenLink');
    if (el) el.textContent = link;
    if (btn) btn.href = link;
  }

  document.getElementById('btnCopyLink')?.addEventListener('click', () => {
    const link = document.getElementById('dispLink')?.textContent;
    if (link) navigator.clipboard.writeText(link).then(() => toast('Link copiado'));
  });

  selTer?.addEventListener('change', load);

  load();
})();
