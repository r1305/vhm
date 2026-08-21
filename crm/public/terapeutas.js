/* ═══════════════════════════════════════════════════════
   VHM CRM — terapeutas.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, fullName, openModal } = window.CRM;

  const DIAS_SEMANA = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  async function loadTerapeutas() {
    try {
      const data = await api('/terapeutas');
      document.getElementById('tablaTerapeutas').innerHTML = data.length
        ? `<div class="ter-grid">${data.map(t => `
          <div class="ter-card">
            <div class="ter-card-top">
              <div class="ter-avatar">${(t.nombre?.[0]||'').toUpperCase()}</div>
              <button class="btn-icon" data-edit="${t.id}" title="Editar"><i class="fas fa-pen"></i></button>
            </div>
            <div class="ter-card-name">${esc(fullName(t))}</div>
            <div class="ter-card-meta">
              <span><i class="fas fa-user" style="width:12px"></i> ${esc(t.username||'—')}</span>
              <span><i class="fas fa-tag" style="width:12px"></i> ${esc(t.rol)}</span>
              ${t.telefono ? `<span><i class="fas fa-mobile-alt" style="width:12px"></i> ${esc(t.telefono)}</span>` : ''}
            </div>
            <div class="ter-card-footer">
              ${t.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}
              <button class="btn btn-outline btn-sm" data-horario="${t.id}" style="margin-left:auto;font-size:11px">
                <i class="fas fa-clock"></i> Horario
              </button>
            </div>
          </div>`).join('')}</div>`
        : '<div class="list-empty">Sin terapeutas registrados</div>';

      document.querySelectorAll('[data-edit]').forEach(btn =>
        btn.addEventListener('click', () => showTerapeutaForm(data.find(t => t.id == btn.dataset.edit)))
      );
      document.querySelectorAll('[data-horario]').forEach(btn =>
        btn.addEventListener('click', () => showHorario(data.find(t => t.id == btn.dataset.horario)))
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  function showTerapeutaForm(t = null) {
    openModal(t ? 'Editar terapeuta' : 'Nuevo terapeuta', `
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="f_nombre" value="${esc(t?.nombre||'')}"></div>
        <div class="form-group"><label class="form-label">Apellido *</label><input class="form-control" id="f_apellido" value="${esc(t?.apellido||'')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Usuario *</label><input class="form-control" id="f_username" value="${esc(t?.username||'')}" placeholder="usuario"></div>
      ${t ? '' : '<div class="form-group"><small style="color:var(--text-muted)"><i class="fas fa-info-circle"></i> Contraseña inicial: <strong><em>usuario</em>2026</strong></small></div>'}
      <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-control" id="f_email" value="${esc(t?.email||'')}"></div>
      ${t ? `<div class="form-group"><label class="form-label">Nueva contraseña (vacío = no cambiar)</label><input type="password" class="form-control" id="f_password" placeholder="••••••••"></div>` : ''}
      <div class="form-row">
        <div class="form-group"><label class="form-label">Rol</label>
          <select class="form-select" id="f_rol">
            <option value="terapeuta"  ${t?.rol==='terapeuta' ?'selected':''}>Terapeuta</option>
            <option value="recepcion"  ${t?.rol==='recepcion' ?'selected':''}>Recepción</option>
            <option value="superadmin" ${t?.rol==='superadmin'?'selected':''}>Superadmin</option>
          </select>
        </div>
        ${t ? `<div class="form-group"><label class="form-label">Estado</label>
          <select class="form-select" id="f_activo">
            <option value="1" ${t.activo?'selected':''}>Activo</option>
            <option value="0" ${!t.activo?'selected':''}>Inactivo</option>
          </select></div>` : ''}
      </div>
      <div class="form-group"><label class="form-label">Especialidad</label><input class="form-control" id="f_especialidad" value="${esc(t?.especialidad||'')}" placeholder="Ej: Ansiedad, Terapia de pareja…"></div>
      <div class="form-group"><label class="form-label">Teléfono WhatsApp</label><input class="form-control" id="f_telefono" value="${esc(t?.telefono||'')}" placeholder="51999999999">
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Para notificaciones de citas por WhatsApp.</div>
      </div>
      <div class="form-group"><label class="form-label">Biografía</label><textarea class="form-control" id="f_bio" rows="2">${esc(t?.bio||'')}</textarea></div>`,
      async () => {
        const body = {
          nombre: document.getElementById('f_nombre').value,
          apellido: document.getElementById('f_apellido').value,
          username: document.getElementById('f_username')?.value || undefined,
          email: document.getElementById('f_email').value || null,
          rol: document.getElementById('f_rol').value,
          telefono: document.getElementById('f_telefono').value || null,
          especialidad: document.getElementById('f_especialidad').value || null,
          bio: document.getElementById('f_bio').value || null,
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

  async function showHorario(ter) {
    let disp = [];
    try { disp = await api(`/terapeutas/${ter.id}/disponibilidad`); } catch (_) {}

    // Mapa dia_semana -> {id, hora_inicio, hora_fin}
    const mapa = {};
    disp.forEach(d => { mapa[d.dia_semana] = d; });

    const BASE = window.__APP_BASE__ || '';
    const link = `${location.origin}${BASE}/agendar/${esc(ter.username)}`;

    const rows = DIAS_SEMANA.map((nombre, i) => {
      const d = mapa[i];
      const hi = d ? String(d.hora_inicio).slice(0,5) : '09:00';
      const hf = d ? String(d.hora_fin).slice(0,5)   : '18:00';
      return `<div class="form-row" style="align-items:center;gap:8px;margin-bottom:6px">
        <div style="width:110px;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="dia_${i}" ${d ? 'checked' : ''} style="width:16px;height:16px">
          <label for="dia_${i}" style="font-size:13px;cursor:pointer">${nombre}</label>
        </div>
        <input type="time" id="hi_${i}" class="form-control" value="${hi}" style="width:110px">
        <span style="font-size:12px;color:var(--text-muted)">a</span>
        <input type="time" id="hf_${i}" class="form-control" value="${hf}" style="width:110px">
      </div>`;
    }).join('');

    openModal(`Horario — ${esc(fullName(ter))}`, `
      <div style="margin-bottom:14px">${rows}</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px">
        <div style="color:var(--text-muted);margin-bottom:4px">Link de agendamiento público:</div>
        <div style="display:flex;align-items:center;gap:8px">
          <code style="flex:1;word-break:break-all;font-size:11px">${link}</code>
          <button class="btn btn-outline btn-sm" id="btnCopyLink"><i class="fas fa-copy"></i></button>
        </div>
      </div>`,
      async () => {
        // Guardar: eliminar todos y re-insertar los activos
        for (const d of disp) {
          await api(`/terapeutas/${ter.id}/disponibilidad/${d.id}`, { method: 'DELETE' });
        }
        for (let i = 0; i < 7; i++) {
          if (!document.getElementById(`dia_${i}`)?.checked) continue;
          const hi = document.getElementById(`hi_${i}`).value;
          const hf = document.getElementById(`hf_${i}`).value;
          if (!hi || !hf || hf <= hi) continue;
          await api(`/terapeutas/${ter.id}/disponibilidad`, {
            method: 'POST', body: { dia_semana: i, hora_inicio: hi, hora_fin: hf },
          });
        }
        toast('Horario guardado');
      }
    );

    document.getElementById('btnCopyLink')?.addEventListener('click', () => {
      navigator.clipboard.writeText(link).then(() => toast('Link copiado'));
    });
  }

  document.getElementById('btnNuevoTerapeuta').addEventListener('click', () => showTerapeutaForm());
  loadTerapeutas();

})();
