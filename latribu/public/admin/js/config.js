(async function () {
  if (!await AdminLayout.init({ page: 'config', title: 'Ajustes' })) return;
  AdminUtils.bindTabs('.sub-tabs', '');
  AdminUtils.bindModalClose();

  // ── Suscripciones ──
  let planes = [], editPlanId = null;

  async function loadSusConfig() {
    const r = await AdminApi.apiFetch('/suscripciones/config');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('sus-activo').checked = !!d.activo;
    document.getElementById('sus-visible').checked = !!d.visible;
  }

  async function loadPlanes() {
    const r = await AdminApi.apiFetch('/suscripciones');
    if (!r.ok) return;
    planes = await r.json();
    const tbody = document.getElementById('sus-tbody');
    if (!planes.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin planes</td></tr>'; return; }
    tbody.innerHTML = planes.map(p => `
      <tr>
        <td>${AdminApi.escapeHtml(p.nombre)}</td>
        <td>S/ ${Number(p.precio).toFixed(2)}</td>
        <td>${p.vigencia_dias} días</td>
        <td>${AdminApi.escapeHtml(p.descripcion || '—')}</td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="editPlan(${p.id})">✏️</button>
          <button class="btn btn-danger btn-xs" onclick="deletePlan(${p.id})">🗑️</button>
        </td>
      </tr>`).join('');
  }

  document.getElementById('btn-sus-cfg-guardar').addEventListener('click', async () => {
    const r = await AdminApi.apiFetch('/suscripciones/config', {
      method: 'PUT',
      body: JSON.stringify({
        activo: document.getElementById('sus-activo').checked,
        visible: document.getElementById('sus-visible').checked,
      }),
    });
    toast(r.ok ? 'Configuración guardada' : 'Error al guardar', r.ok ? 'success' : 'error');
  });

  document.getElementById('btn-nuevo-plan').addEventListener('click', () => {
    editPlanId = null;
    document.getElementById('modal-plan-title').textContent = '💳 Nuevo Plan';
    ['pf-nombre', 'pf-precio', 'pf-descripcion'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('pf-vigencia').value = '30';
    AdminUtils.showModal('modal-plan');
  });

  window.editPlan = function (id) {
    const p = planes.find(x => x.id === id);
    if (!p) return;
    editPlanId = id;
    document.getElementById('modal-plan-title').textContent = '✏️ Editar Plan';
    document.getElementById('pf-nombre').value = p.nombre;
    document.getElementById('pf-precio').value = p.precio;
    document.getElementById('pf-vigencia').value = p.vigencia_dias;
    document.getElementById('pf-descripcion').value = p.descripcion || '';
    AdminUtils.showModal('modal-plan');
  };

  window.deletePlan = async function (id) {
    if (!confirm('¿Eliminar este plan?')) return;
    const r = await AdminApi.apiFetch('/suscripciones/' + id, { method: 'DELETE' });
    toast(r.ok ? 'Plan eliminado' : 'Error al eliminar', r.ok ? 'success' : 'error');
    if (r.ok) loadPlanes();
  };

  document.getElementById('btn-guardar-plan').addEventListener('click', async () => {
    const body = {
      nombre: document.getElementById('pf-nombre').value.trim(),
      precio: document.getElementById('pf-precio').value,
      vigencia_dias: document.getElementById('pf-vigencia').value,
      descripcion: document.getElementById('pf-descripcion').value.trim(),
    };
    if (!body.nombre || !body.precio) return toast('Nombre y precio son obligatorios', 'error');
    const url = editPlanId ? '/suscripciones/' + editPlanId : '/suscripciones';
    const method = editPlanId ? 'PUT' : 'POST';
    const r = await AdminApi.apiFetch(url, { method, body: JSON.stringify(body) });
    const d = await r.json();
    toast(r.ok ? 'Plan guardado' : (d.error || 'Error'), r.ok ? 'success' : 'error');
    if (r.ok) { AdminUtils.hideModal('modal-plan'); loadPlanes(); }
  });

  // ── Culqi ──
  async function loadCulqi() {
    const r = await AdminApi.apiFetch('/config-culqi');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('culqi-activo').checked = !!d.activo;
    document.getElementById('culqi-modo').value = d.modo || 'sandbox';
    document.getElementById('culqi-pk').value = d.public_key || '';
    document.getElementById('culqi-sk').value = d.secret_key || '';
  }

  document.getElementById('btn-culqi-guardar').addEventListener('click', async () => {
    const body = {
      activo: document.getElementById('culqi-activo').checked,
      modo: document.getElementById('culqi-modo').value,
      public_key: document.getElementById('culqi-pk').value.trim(),
      secret_key: document.getElementById('culqi-sk').value.trim(),
    };
    const r = await AdminApi.apiFetch('/config-culqi', { method: 'PUT', body: JSON.stringify(body) });
    const d = await r.json();
    AdminUtils.mostrarMsg(document.getElementById('culqi-msg'), r.ok ? 'Guardado' : (d.error || 'Error'), r.ok);
  });

  // ── Config general (pixel, whatsapp, redes) ──
  async function loadConfig() {
    const r = await AdminApi.apiFetch('/config');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('pixel-activo').checked = !!d.pixel_activo;
    document.getElementById('pixel-id').value = d.pixel_id || '';
    document.getElementById('wa-activo').checked = !!d.whatsapp_activo;
    document.getElementById('wa-numero').value = d.whatsapp_numero || '';
    document.getElementById('wa-mensaje').value = d.whatsapp_mensaje || '';
    document.getElementById('red-instagram').value = d.instagram || '';
    document.getElementById('red-facebook').value = d.facebook || '';
    document.getElementById('red-youtube').value = d.youtube || '';
    document.getElementById('red-tiktok').value = d.tiktok || '';
  }

  async function saveConfig(extra) {
    const body = {
      pixel_id: document.getElementById('pixel-id').value.trim(),
      pixel_activo: document.getElementById('pixel-activo').checked,
      whatsapp_numero: document.getElementById('wa-numero').value.trim(),
      whatsapp_mensaje: document.getElementById('wa-mensaje').value.trim(),
      whatsapp_activo: document.getElementById('wa-activo').checked,
      instagram: document.getElementById('red-instagram').value.trim(),
      facebook: document.getElementById('red-facebook').value.trim(),
      youtube: document.getElementById('red-youtube').value.trim(),
      tiktok: document.getElementById('red-tiktok').value.trim(),
      ...extra,
    };
    const r = await AdminApi.apiFetch('/config', { method: 'PUT', body: JSON.stringify(body) });
    return r.ok;
  }

  document.getElementById('btn-pixel-guardar').addEventListener('click', async () => {
    const ok = await saveConfig();
    AdminUtils.mostrarMsg(document.getElementById('pixel-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });
  document.getElementById('btn-wa-guardar').addEventListener('click', async () => {
    const ok = await saveConfig();
    AdminUtils.mostrarMsg(document.getElementById('wa-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });
  document.getElementById('btn-redes-guardar').addEventListener('click', async () => {
    const ok = await saveConfig();
    AdminUtils.mostrarMsg(document.getElementById('redes-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });

  // Init
  loadSusConfig();
  loadPlanes();
  loadCulqi();
  loadConfig();
})();
