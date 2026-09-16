(function () {
  'use strict';

  const { api, toast, esc, openModal } = window.CRM;

  async function loadPaquetes() {
    try {
      const data = await api('/paquetes');
      const el = document.getElementById('tablaPaquetes');
      if (!data.length) {
        el.innerHTML = '<div class="list-empty">No hay paquetes registrados</div>';
        return;
      }
      el.innerHTML = `<div class="pkg-grid">${data.map((p) => `
        <div class="pkg-card">
          <div class="pkg-card-top">
            <div class="pkg-card-name">${esc(p.nombre)}</div>
            <button class="btn-icon" data-edit="${p.id}" title="Editar"><i class="fas fa-pen"></i></button>
          </div>
          <div class="pkg-card-meta">
            <span><i class="fas fa-calendar-check"></i> ${p.sesiones} sesiones</span>
            <span><i class="fas fa-hourglass-half"></i> Validez: ${p.validez_dias} días</span>
            <span><i class="fas fa-coins"></i> S/ ${Number(p.precio).toFixed(2)}</span>
            <span><i class="fas fa-users"></i> Comunidad: ${p.accede_comunidad ? 'Sí' : 'No'}</span>
          </div>
          <div class="pkg-card-footer">
            ${p.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}
          </div>
        </div>`).join('')}</div>`;

      document.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => showForm(data.find((x) => x.id == btn.dataset.edit)));
      });
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  function showForm(p = null) {
    openModal(p ? 'Editar paquete' : 'Nuevo paquete', `
      <div class="form-group"><label class="form-label">Nombre *</label>
        <input class="form-control" id="pkg_nombre" value="${esc(p?.nombre || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Sesiones *</label>
          <input type="number" min="1" class="form-control" id="pkg_sesiones" value="${p?.sesiones ?? 4}"></div>
        <div class="form-group"><label class="form-label">Validez (días) *</label>
          <input type="number" min="1" class="form-control" id="pkg_validez" value="${p?.validez_dias ?? 30}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Precio (S/) *</label>
          <input type="number" min="0" step="0.01" class="form-control" id="pkg_precio" value="${p?.precio ?? 0}"></div>
        <div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:24px">
          <input type="checkbox" id="pkg_comunidad" ${p?.accede_comunidad ? 'checked' : ''} style="width:18px;height:18px">
          <label class="form-label" style="margin:0">Accede a Comunidad</label>
        </div>
      </div>
      ${p ? `<div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="pkg_activo" ${p.activo ? 'checked' : ''} style="width:18px;height:18px">
        <label class="form-label" style="margin:0">Paquete activo (visible para asignar)</label>
      </div>` : ''}
    `, async () => {
      const body = {
        nombre: document.getElementById('pkg_nombre').value.trim(),
        sesiones: Number(document.getElementById('pkg_sesiones').value),
        validez_dias: Number(document.getElementById('pkg_validez').value),
        precio: Number(document.getElementById('pkg_precio').value),
        accede_comunidad: document.getElementById('pkg_comunidad').checked,
      };
      if (!body.nombre) throw new Error('El nombre es obligatorio');
      if (p) {
        body.activo = document.getElementById('pkg_activo').checked;
        await api(`/paquetes/${p.id}`, { method: 'PUT', body });
      } else {
        await api('/paquetes', { method: 'POST', body });
      }
      loadPaquetes();
    }, { successMessage: p ? 'Paquete actualizado' : 'Paquete creado' });
  }

  document.getElementById('btnNuevoPaquete')?.addEventListener('click', () => showForm());
  loadPaquetes();
})();
