/* VHM CRM — disponibilidad.js */
(function () {
  'use strict';

  const { api, toast } = window.CRM;
  const BASE = window.__APP_BASE__ || '';

  const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  const selTer = document.getElementById('selTerapeuta');
  function getTerId() {
    return selTer ? parseInt(selTer.value) : window.__USER_ID__;
  }

  let dispActual = [];
  let username   = '';

  // Estado local: { [dia]: [{hi, hf}, ...] }
  let estado = {};

  function estadoInicial() {
    const mapa = {};
    DIAS.forEach((_, i) => { mapa[i] = null; }); // null = día desactivado
    dispActual.forEach(d => {
      if (!mapa[d.dia_semana]) mapa[d.dia_semana] = [];
      mapa[d.dia_semana].push({ hi: String(d.hora_inicio).slice(0,5), hf: String(d.hora_fin).slice(0,5) });
    });
    return mapa;
  }

  async function load() {
    const tid = getTerId();
    try {
      dispActual = await api(`/terapeutas/${tid}/disponibilidad`);
      const ters = await api('/terapeutas');
      const ter  = ters.find(t => t.id === tid);
      username   = ter?.username || '';
      estado = estadoInicial();
      render();
      updateLink();
    } catch (e) { toast(e.message, 'danger'); }
  }

  function renderDia(i) {
    const rangos = estado[i]; // null = desactivado, [] o [{hi,hf}...] = activo
    const activo = rangos !== null;
    const lista  = activo ? rangos : [];

    const rangosHtml = lista.map((r, ri) => `
      <div class="disp-rango" data-dia="${i}" data-ri="${ri}">
        <input type="time" class="form-control disp-hi" value="${r.hi}" ${activo ? '' : 'disabled'}>
        <span>a</span>
        <input type="time" class="form-control disp-hf" value="${r.hf}" ${activo ? '' : 'disabled'}>
        ${lista.length > 1
          ? `<button class="disp-btn-del" data-dia="${i}" data-ri="${ri}" title="Eliminar rango">×</button>`
          : '<span class="disp-rango-spacer"></span>'}
      </div>`).join('');

    return `
      <div class="disp-row ${activo ? 'disp-activo' : ''}" data-dia="${i}">
        <div class="disp-check">
          <input type="checkbox" id="dia_${i}" ${activo ? 'checked' : ''}>
          <label for="dia_${i}">${DIAS[i]}</label>
        </div>
        <div class="disp-rangos ${activo ? '' : 'disp-horas-disabled'}">
          ${rangosHtml}
          ${activo ? `<button class="disp-btn-add" data-dia="${i}" title="Agregar rango horario">+ rango</button>` : ''}
        </div>
      </div>`;
  }

  function render() {
    const html = DIAS.map((_, i) => renderDia(i)).join('');

    document.getElementById('dispGrid').innerHTML = `
      <div class="disp-grid">${html}</div>
      <div style="margin-top:16px">
        <button class="btn btn-primary" id="btnGuardarDisp"><i class="fas fa-save"></i> Guardar horario</button>
      </div>`;

    bindEvents();
  }

  function rerenderDia(i) {
    const row = document.querySelector(`.disp-row[data-dia="${i}"]`);
    if (!row) return;
    row.outerHTML = renderDia(i);
    bindEvents();
  }

  function bindEvents() {
    // Checkboxes
    DIAS.forEach((_, i) => {
      document.getElementById(`dia_${i}`)?.addEventListener('change', e => {
        estado[i] = e.target.checked ? [{ hi: '09:00', hf: '18:00' }] : null;
        rerenderDia(i);
      });
    });

    // Inputs de tiempo — sincronizar al estado
    document.querySelectorAll('.disp-rango').forEach(el => {
      const i  = parseInt(el.dataset.dia);
      const ri = parseInt(el.dataset.ri);
      el.querySelector('.disp-hi')?.addEventListener('change', e => {
        if (estado[i]?.[ri]) estado[i][ri].hi = e.target.value;
      });
      el.querySelector('.disp-hf')?.addEventListener('change', e => {
        if (estado[i]?.[ri]) estado[i][ri].hf = e.target.value;
      });
    });

    // Botones + rango
    document.querySelectorAll('.disp-btn-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.dia);
        if (!estado[i]) return;
        // Leer valores actuales del DOM antes de re-renderizar
        syncDomToEstado(i);
        estado[i].push({ hi: '09:00', hf: '18:00' });
        rerenderDia(i);
      });
    });

    // Botones × eliminar rango
    document.querySelectorAll('.disp-btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i  = parseInt(btn.dataset.dia);
        const ri = parseInt(btn.dataset.ri);
        syncDomToEstado(i);
        estado[i].splice(ri, 1);
        rerenderDia(i);
      });
    });

    document.getElementById('btnGuardarDisp')?.addEventListener('click', guardar);
  }

  // Leer valores actuales del DOM y volcarlos al estado antes de mutar
  function syncDomToEstado(i) {
    document.querySelectorAll(`.disp-rango[data-dia="${i}"]`).forEach(el => {
      const ri = parseInt(el.dataset.ri);
      if (estado[i]?.[ri]) {
        estado[i][ri].hi = el.querySelector('.disp-hi')?.value || estado[i][ri].hi;
        estado[i][ri].hf = el.querySelector('.disp-hf')?.value || estado[i][ri].hf;
      }
    });
  }

  async function guardar() {
    const tid = getTerId();
    const btn = document.getElementById('btnGuardarDisp');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';

    // Sincronizar todo el DOM al estado antes de guardar
    DIAS.forEach((_, i) => { if (estado[i]) syncDomToEstado(i); });

    try {
      for (const d of dispActual) {
        await api(`/terapeutas/${tid}/disponibilidad/${d.id}`, { method: 'DELETE' });
      }
      for (let i = 0; i < 7; i++) {
        if (!estado[i]) continue;
        for (const r of estado[i]) {
          if (!r.hi || !r.hf || r.hf <= r.hi) { toast(`Horario inválido para ${DIAS[i]}`, 'danger'); continue; }
          await api(`/terapeutas/${tid}/disponibilidad`, {
            method: 'POST', body: { dia_semana: i, hora_inicio: r.hi, hora_fin: r.hf },
          });
        }
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
