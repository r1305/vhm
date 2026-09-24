(function () {
  'use strict';

  const { api, toast, esc, openModal, confirmDialog } = window.CRM;
  const isSuperAdmin = window.__USER_ROL__ === 'superadmin';
  const isAdmin = ['superadmin', 'admin', 'recepcion'].includes(window.__USER_ROL__);

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
            <div class="pkg-card-top-actions">
              ${isAdmin ? `<button class="btn-icon" data-edit="${p.id}" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
              ${isSuperAdmin ? `<button class="btn-icon btn-icon-danger" data-delete="${p.id}" data-name="${esc(p.nombre)}" title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
            </div>
          </div>
          <div class="pkg-card-meta">
            <span><i class="fas fa-calendar-check"></i> ${p.sesiones} sesiones</span>
            <span><i class="fas fa-hourglass-half"></i> Validez: ${p.validez_dias} días</span>
            <span><i class="fas fa-clock"></i> Sig. cuota: ${p.dias_siguiente_cuota || 15} días</span>
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
      document.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Eliminar paquete',
            message: `¿Eliminar "${btn.dataset.name}"? Si tiene pacientes asignados se desactivará en lugar de eliminarse.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          try {
            const res = await api(`/paquetes/${btn.dataset.delete}`, { method: 'DELETE' });
            toast(res.deactivated ? 'Paquete desactivado (tiene pacientes asignados)' : 'Paquete eliminado', 'success');
            loadPaquetes();
          } catch (err) {
            toast(err.message, 'danger');
          }
        });
      });
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  function showForm(p = null) {
    if (!isAdmin) return;
    openModal(p ? 'Editar paquete' : 'Nuevo paquete', `
      <div class="form-group"><label class="form-label">Nombre *</label>
        <input class="form-control" id="pkg_nombre" value="${esc(p?.nombre || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Sesiones *</label>
          <input type="number" min="1" class="form-control" id="pkg_sesiones" value="${p?.sesiones ?? 4}"></div>
        <div class="form-group"><label class="form-label">Validez (días) *</label>
          <input type="number" min="1" class="form-control" id="pkg_validez" value="${p?.validez_dias ?? 30}"></div>
        <div class="form-group"><label class="form-label">Días para siguiente cuota *</label>
          <input type="number" min="15" class="form-control" id="pkg_dias_cuota" value="${p?.dias_siguiente_cuota ?? 15}">
          <span style="font-size:11px;color:var(--text-muted)">Mínimo 15 días entre cada cuota</span></div>
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
        dias_siguiente_cuota: Number(document.getElementById('pkg_dias_cuota').value),
        precio: Number(document.getElementById('pkg_precio').value),
        accede_comunidad: document.getElementById('pkg_comunidad').checked,
      };
      if (!body.nombre) throw new Error('El nombre es obligatorio');
      if (!body.dias_siguiente_cuota || body.dias_siguiente_cuota < 15) {
        throw new Error('Los días para la siguiente cuota deben ser al menos 15');
      }
      if (p) {
        body.activo = document.getElementById('pkg_activo').checked;
        await api(`/paquetes/${p.id}`, { method: 'PUT', body });
      } else {
        await api('/paquetes', { method: 'POST', body });
      }
      loadPaquetes();
    }, { successMessage: p ? 'Paquete actualizado' : 'Paquete creado' });
  }

  if (isAdmin) document.getElementById('btnNuevoPaquete')?.addEventListener('click', () => showForm());
  loadPaquetes();
})();
