/* ═══════════════════════════════════════════════════════
   VHM CRM — part4.js  Pagos · Lista de espera · Terapeutas
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fmtMoney, badge, fullName,
            openModal, viewLoaders, isAdmin, getUser } = window.CRM;

    /* ══════════════════════════════════════════════════
       PAGOS
    ══════════════════════════════════════════════════ */
    const ESTADO_PAGO = {
      pendiente:   { label: 'Pendiente',   css: 'badge-yellow' },
      completado:  { label: 'Completado',  css: 'badge-green'  },
      reembolsado: { label: 'Reembolsado', css: 'badge-blue'   },
      fallido:     { label: 'Fallido',     css: 'badge-red'    },
    };

    let pagosCache = [];

    async function loadPagos() {
      try {
        const pid = document.getElementById('pagosPacienteSelect').value;
        const data = await api(`/pagos${pid ? `?paciente_id=${pid}` : ''}`);
        pagosCache = data;
        document.getElementById('tablaPagos').innerHTML = data.length
          ? data.map(p => `
            <tr>
              <td>${esc(p.paciente_nombre || '—')}</td>
              <td><strong>${fmtMoney(p.monto)}</strong> <small style="color:var(--text-muted)">${esc(p.moneda)}</small></td>
              <td>${esc(p.metodo)}</td>
              <td>${badge(p.estado, ESTADO_PAGO)}</td>
              <td>${fmtDate(p.created_at)}</td>
            </tr>`).join('')
          : '<tr><td colspan="5" class="list-empty">Sin pagos registrados</td></tr>';
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function getPacientesOpts(selectedId = null) {
      const ps = await api('/pacientes').catch(() => []);
      return `<option value="">— Seleccionar —</option>` +
        ps.map(p => `<option value="${p.id}" ${p.id == selectedId ? 'selected' : ''}>${esc(fullName(p))}</option>`).join('');
    }

    async function showNuevoPago() {
      const opts = await getPacientesOpts();
      openModal('Registrar pago', `
        <div class="form-group">
          <label class="form-label">Paciente *</label>
          <select class="form-select" id="f_paciente_id">${opts}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Monto *</label>
            <input type="number" step="0.01" min="0" class="form-control" id="f_monto" placeholder="0.00">
          </div>
          <div class="form-group">
            <label class="form-label">Moneda</label>
            <select class="form-select" id="f_moneda">
              <option value="PEN">PEN (S/)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Método *</label>
            <select class="form-select" id="f_metodo">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="yape">Yape</option>
              <option value="plin">Plin</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select class="form-select" id="f_estado">
              <option value="completado">Completado</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Referencia (n° op, voucher…)</label>
          <input class="form-control" id="f_referencia" placeholder="Opcional">
        </div>
        <div class="form-group">
          <label class="form-label">Notas</label>
          <textarea class="form-control" id="f_notas" rows="2"></textarea>
        </div>`, async () => {
        const body = {
          paciente_id: document.getElementById('f_paciente_id').value,
          monto:       document.getElementById('f_monto').value,
          moneda:      document.getElementById('f_moneda').value,
          metodo:      document.getElementById('f_metodo').value,
          estado:      document.getElementById('f_estado').value,
          referencia:  document.getElementById('f_referencia').value || null,
          notas:       document.getElementById('f_notas').value || null,
        };
        if (!body.paciente_id || !body.monto) throw new Error('Paciente y monto son requeridos');
        await api('/pagos', { method: 'POST', body });
        toast('Pago registrado');
        loadPagos();
      });
    }

    async function showNuevoPack() {
      const opts = await getPacientesOpts();
      openModal('Nuevo pack de sesiones', `
        <div class="form-group">
          <label class="form-label">Paciente *</label>
          <select class="form-select" id="f_paciente_id">${opts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Nombre del pack</label>
          <input class="form-control" id="f_nombre" placeholder="Ej: Pack 4 sesiones mensuales">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">N° sesiones *</label>
            <input type="number" min="1" class="form-control" id="f_sesiones" value="4">
          </div>
          <div class="form-group">
            <label class="form-label">Monto total *</label>
            <input type="number" step="0.01" min="0" class="form-control" id="f_monto" placeholder="0.00">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Vence el</label>
          <input type="date" class="form-control" id="f_vence">
        </div>`, async () => {
        const body = {
          paciente_id:    document.getElementById('f_paciente_id').value,
          nombre:         document.getElementById('f_nombre').value || 'Pack de sesiones',
          sesiones_total: document.getElementById('f_sesiones').value,
          monto_total:    document.getElementById('f_monto').value,
          vence_at:       document.getElementById('f_vence').value || null,
        };
        if (!body.paciente_id || !body.monto_total) throw new Error('Paciente y monto requeridos');
        await api('/pagos/packs', { method: 'POST', body });
        toast('Pack creado');
        loadPagos();
      });
    }

    document.getElementById('pagosPacienteSelect').addEventListener('change', loadPagos);
    document.getElementById('btnNuevoPago').addEventListener('click', showNuevoPago);
    document.getElementById('btnNuevoPack').addEventListener('click', showNuevoPack);

    viewLoaders['pagos'] = async () => {
      // poblar select de pacientes
      const ps = await api('/pacientes').catch(() => []);
      const sel = document.getElementById('pagosPacienteSelect');
      sel.innerHTML = `<option value="">— Todos los pacientes —</option>` +
        ps.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('');
      loadPagos();
    };

    /* ══════════════════════════════════════════════════
       LISTA DE ESPERA
    ══════════════════════════════════════════════════ */
    async function loadEspera() {
      try {
        const data = await api('/reportes/lista-espera');
        const cont = document.getElementById('listaEsperaContent');
        cont.innerHTML = data.length
          ? data.map(item => `
            <div class="list-item">
              <div class="list-icon"><i class="fas fa-hourglass-half"></i></div>
              <div style="flex:1">
                <div class="list-title">${esc(item.nombre)} ${esc(item.apellido || '')}</div>
                <div class="list-meta">
                  ${item.email ? `<span>${esc(item.email)}</span>` : ''}
                  ${item.especialidad ? `<span>· ${esc(item.especialidad)}</span>` : ''}
                  <span>· Desde ${fmtDate(item.fecha_solicitud)}</span>
                  ${item.notificado ? '<span class="badge badge-green" style="margin-left:4px">Notificado</span>' : ''}
                </div>
              </div>
              <div style="display:flex;gap:4px">
                ${!item.notificado ? `<button class="btn btn-sm btn-outline" data-notif-espera="${item.id}"><i class="fas fa-bell"></i> Notificar</button>` : ''}
              </div>
            </div>`).join('')
          : '<div class="list-empty">Lista de espera vacía</div>';

        document.querySelectorAll('[data-notif-espera]').forEach(btn =>
          btn.addEventListener('click', async () => {
            try {
              await api(`/reportes/lista-espera/${btn.dataset.notifEspera}/notificar`, { method: 'POST' });
              toast('Notificación enviada');
              loadEspera();
            } catch (err) { toast(err.message, 'danger'); }
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function showNuevoEspera() {
      const ps = await api('/pacientes').catch(() => []);
      const ts = await api('/terapeutas').catch(() => []);
      openModal('Agregar a lista de espera', `
        <div class="form-group">
          <label class="form-label">Paciente *</label>
          <select class="form-select" id="f_paciente_id">
            <option value="">— Seleccionar —</option>
            ${ps.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Terapeuta preferido</label>
          <select class="form-select" id="f_terapeuta_id">
            <option value="">— Sin preferencia —</option>
            ${ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Especialidad requerida</label>
          <input class="form-control" id="f_especialidad" placeholder="Ej: Ansiedad, Terapia de pareja…">
        </div>`, async () => {
        const body = {
          paciente_id:  document.getElementById('f_paciente_id').value,
          terapeuta_id: document.getElementById('f_terapeuta_id').value || null,
          especialidad: document.getElementById('f_especialidad').value || null,
        };
        if (!body.paciente_id) throw new Error('Selecciona un paciente');
        await api('/reportes/lista-espera', { method: 'POST', body });
        toast('Agregado a lista de espera');
        loadEspera();
      });
    }

    document.getElementById('btnNuevoEspera').addEventListener('click', showNuevoEspera);
    viewLoaders['espera'] = loadEspera;

    /* ══════════════════════════════════════════════════
       TERAPEUTAS (solo admin)
    ══════════════════════════════════════════════════ */
    async function loadTerapeutas() {
      if (!isAdmin()) return;
      try {
        const data = await api('/terapeutas');
        document.getElementById('tablaTerapeutas').innerHTML = data.length
          ? `<div class="ter-grid">${data.map(t => `
            <div class="ter-card">
              <div class="ter-card-top">
                <div class="ter-avatar">${(t.nombre?.[0] || '').toUpperCase()}</div>
                <button class="btn-icon" data-edit-terapeuta="${t.id}" title="Editar"><i class="fas fa-pen"></i></button>
              </div>
              <div class="ter-card-name">${esc(fullName(t))}</div>
              <div class="ter-card-meta">
                <span><i class="fas fa-user" style="width:12px"></i> ${esc(t.username || '—')}</span>
                <span><i class="fas fa-tag" style="width:12px"></i> ${esc(t.rol)}</span>
                ${t.telefono ? `<span><i class="fas fa-mobile-alt" style="width:12px"></i> ${esc(t.telefono)}</span>` : ''}
              </div>
              <div class="ter-card-footer">
                ${t.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}
              </div>
            </div>`).join('')}</div>`
          : '<div class="list-empty">Sin terapeutas registrados</div>';

        document.querySelectorAll('[data-edit-terapeuta]').forEach(btn =>
          btn.addEventListener('click', () => showTerapeutaForm(data.find(t => t.id == btn.dataset.editTerapeuta)))
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    function showTerapeutaForm(t = null) {
      openModal(t ? 'Editar terapeuta' : 'Nuevo terapeuta', `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nombre *</label>
            <input class="form-control" id="f_nombre" value="${esc(t?.nombre || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Apellido *</label>
            <input class="form-control" id="f_apellido" value="${esc(t?.apellido || '')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Usuario *</label>
          <input class="form-control" id="f_username" value="${esc(t?.username || '')}" placeholder="usuario">
        </div>
        ${t ? '' : '<div class="form-group"><small style="color:var(--text-muted)"><i class="fas fa-info-circle"></i> La contraseña inicial será: <strong><em>usuario</em>2026</strong></small></div>'}
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" class="form-control" id="f_email" value="${esc(t?.email || '')}">
        </div>
        ${t ? `<div class="form-group">
          <label class="form-label">Nueva contraseña (dejar vacío para no cambiar)</label>
          <input type="password" class="form-control" id="f_password" placeholder="••••••••">
        </div>` : ''}
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Rol</label>
            <select class="form-select" id="f_rol">
              <option value="terapeuta"  ${t?.rol === 'terapeuta'  ? 'selected' : ''}>Terapeuta</option>
              <option value="recepcion"  ${t?.rol === 'recepcion'  ? 'selected' : ''}>Recepción</option>
              <option value="superadmin" ${t?.rol === 'superadmin' ? 'selected' : ''}>Superadmin</option>
            </select>
          </div>
          ${t ? `
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select class="form-select" id="f_activo">
              <option value="1" ${t.activo ? 'selected' : ''}>Activo</option>
              <option value="0" ${!t.activo ? 'selected' : ''}>Inactivo</option>
            </select>
          </div>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">Especialidad</label>
          <input class="form-control" id="f_especialidad" value="${esc(t?.especialidad || '')}" placeholder="Ej: Ansiedad, Terapia de pareja…">
        </div>
        <div class="form-group">
          <label class="form-label">Teléfono WhatsApp</label>
          <input class="form-control" id="f_telefono" value="${esc(t?.telefono || '')}" placeholder="51999999999 (con código de país)">
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Para notificaciones de citas por WhatsApp.</div>
        </div>
        <div class="form-group">
          <label class="form-label">Biografía</label>
          <textarea class="form-control" id="f_bio" rows="2">${esc(t?.bio || '')}</textarea>
        </div>`, async () => {
        const body = {
          nombre:       document.getElementById('f_nombre').value,
          apellido:     document.getElementById('f_apellido').value,
          username:     document.getElementById('f_username')?.value || undefined,
          email:        document.getElementById('f_email').value || null,
          rol:          document.getElementById('f_rol').value,
          telefono:     document.getElementById('f_telefono').value || null,
          especialidad: document.getElementById('f_especialidad').value || null,
          bio:          document.getElementById('f_bio').value || null,
        };
        if (t) {
          const pass = document.getElementById('f_password')?.value;
          if (pass) body.password = pass;
          body.activo = document.getElementById('f_activo')?.value === '1';
          await api(`/terapeutas/${t.id}`, { method: 'PUT', body });
        } else {
          if (!body.username) throw new Error('El usuario es requerido');
          body.password = body.username + '2026';
          await api('/terapeutas', { method: 'POST', body });
        }
        toast(t ? 'Terapeuta actualizado' : 'Terapeuta creado');
        loadTerapeutas();
      });
    }

    document.getElementById('btnNuevoTerapeuta')?.addEventListener('click', () => showTerapeutaForm());
    viewLoaders['terapeutas'] = loadTerapeutas;

  }); // ready
})();
