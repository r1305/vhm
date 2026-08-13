/* ═══════════════════════════════════════════════════════
   VHM CRM — marketing.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, openModal } = window.CRM;

  const ESTADO_CAMP = {
    borrador:   { label: 'Borrador',   css: 'badge-gray'   },
    enviando:   { label: 'Enviando…',  css: 'badge-yellow' },
    completada: { label: 'Completada', css: 'badge-green'  },
    cancelada:  { label: 'Cancelada',  css: 'badge-red'    },
  };

  function badgeCamp(estado) {
    const e = ESTADO_CAMP[estado] || { label: estado, css: 'badge-gray' };
    return `<span class="badge ${e.css}">${esc(e.label)}</span>`;
  }

  function mktTab(tab) {
    document.getElementById('mktCampanas').style.display     = tab === 'campanas'     ? '' : 'none';
    document.getElementById('mktSuscriptores').style.display = tab === 'suscriptores' ? '' : 'none';
    document.getElementById('mktBtnCampanas').className      = `btn btn-sm ${tab === 'campanas'     ? 'btn-primary' : 'btn-outline'}`;
    document.getElementById('mktBtnSuscriptores').className  = `btn btn-sm ${tab === 'suscriptores' ? 'btn-primary' : 'btn-outline'}`;
    if (tab === 'suscriptores') loadSuscriptores();
    else loadCampanas();
  }

  async function loadCampanas() {
    try {
      const data = await api('/marketing/campanas');
      document.getElementById('tablaCampanas').innerHTML = data.length
        ? data.map(c => `
          <tr>
            <td><strong>${esc(c.nombre)}</strong></td>
            <td>${esc(c.asunto)}</td>
            <td>${c.segmento ? `<span class="badge badge-blue">${esc(c.segmento)}</span>` : '—'}</td>
            <td>${badgeCamp(c.estado)}</td>
            <td>${c.total_enviados||0}</td>
            <td style="white-space:nowrap">
              ${c.estado === 'borrador' ? `
                <button class="btn-icon" data-edit="${c.id}" title="Editar"><i class="fas fa-pen"></i></button>
                <button class="btn btn-sm btn-success" data-enviar="${c.id}"><i class="fas fa-paper-plane"></i> Enviar</button>
                <button class="btn-icon danger" data-del="${c.id}" title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
            </td>
          </tr>`).join('')
        : '<tr><td colspan="6" class="list-empty">Sin campañas</td></tr>';

      document.querySelectorAll('[data-edit]').forEach(btn =>
        btn.addEventListener('click', () => showCampanaForm(data.find(c => c.id == btn.dataset.edit)))
      );
      document.querySelectorAll('[data-enviar]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm('¿Enviar esta campaña? Esta acción no se puede deshacer.')) return;
          try { const r = await api(`/marketing/campanas/${btn.dataset.enviar}/enviar`, { method:'POST' }); toast(`Enviando a ${r.total} suscriptores`); loadCampanas(); }
          catch (err) { toast(err.message, 'danger'); }
        })
      );
      document.querySelectorAll('[data-del]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar campaña?')) return;
          await api(`/marketing/campanas/${btn.dataset.del}`, { method:'DELETE' });
          toast('Campaña eliminada'); loadCampanas();
        })
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  function showCampanaForm(c = null) {
    openModal(c ? 'Editar campaña' : 'Nueva campaña', `
      <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="f_nombre" value="${esc(c?.nombre||'')}"></div>
      <div class="form-group"><label class="form-label">Asunto del email *</label><input class="form-control" id="f_asunto" value="${esc(c?.asunto||'')}"></div>
      <div class="form-group"><label class="form-label">Segmento (vacío = todos)</label><input class="form-control" id="f_segmento" value="${esc(c?.segmento||'')}" placeholder="ansiedad, pareja, infantil…"></div>
      <div class="form-group"><label class="form-label">Contenido HTML *</label>
        <textarea class="form-control" id="f_cuerpo" rows="8" placeholder="<p>Hola {{nombre}},</p>">${esc(c?.cuerpo_html||'')}</textarea>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Usa <code>{{nombre}}</code> para personalizar.</div>
      </div>`,
      async () => {
        const body = {
          nombre: document.getElementById('f_nombre').value,
          asunto: document.getElementById('f_asunto').value,
          cuerpo_html: document.getElementById('f_cuerpo').value,
          segmento: document.getElementById('f_segmento').value || null,
        };
        if (!body.nombre || !body.asunto || !body.cuerpo_html) throw new Error('Nombre, asunto y contenido son requeridos');
        if (c) await api(`/marketing/campanas/${c.id}`, { method:'PUT', body });
        else   await api('/marketing/campanas', { method:'POST', body });
        toast(c ? 'Campaña actualizada' : 'Campaña creada'); loadCampanas();
      }, { large: true });
  }

  async function loadSuscriptores() {
    try {
      const data = await api('/marketing/suscriptores');
      document.getElementById('tablaSuscriptores').innerHTML = data.length
        ? data.map(s => `
          <tr>
            <td>${esc(s.email)}</td><td>${esc(s.nombre||'—')}</td>
            <td>${s.segmento ? `<span class="badge badge-blue">${esc(s.segmento)}</span>` : '—'}</td>
            <td>${s.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}</td>
            <td>${fmtDate(s.created_at)}</td>
            <td><button class="btn-icon danger" data-del="${s.id}" title="Desuscribir"><i class="fas fa-times"></i></button></td>
          </tr>`).join('')
        : '<tr><td colspan="6" class="list-empty">Sin suscriptores</td></tr>';

      document.querySelectorAll('[data-del]').forEach(btn =>
        btn.addEventListener('click', async () => {
          await api(`/marketing/suscriptores/${btn.dataset.del}`, { method:'DELETE' });
          toast('Suscriptor desactivado'); loadSuscriptores();
        })
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  document.getElementById('mktBtnCampanas').addEventListener('click', () => mktTab('campanas'));
  document.getElementById('mktBtnSuscriptores').addEventListener('click', () => mktTab('suscriptores'));
  document.getElementById('btnNuevaCampana').addEventListener('click', () => showCampanaForm());
  loadCampanas();

})();
