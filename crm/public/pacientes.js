/* ═══════════════════════════════════════════════════════
   VHM CRM — pacientes.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, badge, fullName,
          openModal, closeModal, ESTADO_PACIENTE } = window.CRM;

  let terapeutasCache = [];
  let chipTerapeutaId = null;

  /* ── Chips ──────────────────────────────────────────── */
  function bindChips() {
    document.querySelectorAll('#terapeutaChips .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.chipId);
        chipTerapeutaId = chipTerapeutaId === id ? null : id;
        document.querySelectorAll('#terapeutaChips .chip').forEach(c => c.classList.remove('active'));
        if (chipTerapeutaId) btn.classList.add('active');
        loadPacientes();
      });
    });
  }

  /* ── Lista ──────────────────────────────────────────── */
  async function loadPacientes() {
    try {
      const qs = new URLSearchParams();
      const q      = document.getElementById('buscarPaciente').value;
      const estado = document.getElementById('filtroPacienteEstado').value;
      if (q)              qs.set('q', q);
      if (estado)         qs.set('estado', estado);
      if (chipTerapeutaId) qs.set('terapeuta_id', chipTerapeutaId);
      const data = await api(`/pacientes?${qs}`);
      window.CRM.pacientesCache = data;

      document.getElementById('tablaPacientes').innerHTML = data.length
        ? data.map(p => {
          const total    = Number(p.sesiones_total) || 0;
          const confirm  = Number(p.citas_confirmadas) || 0;
          const pendient = Math.max(0, total - confirm);
          return `
          <div class="pac-card">
            <div class="pac-card-top">
              <div class="pac-avatar">${(p.nombre?.[0]||'').toUpperCase()}</div>
              <div style="display:flex;gap:4px">
                <button class="btn-icon" data-ver="${p.id}" title="Ver detalle"><i class="fas fa-eye"></i></button>
                ${window.__USER_ROL__ !== 'terapeuta' ? `<button class="btn-icon" data-edit="${p.id}" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
              </div>
            </div>
            <div class="pac-card-name">${esc(fullName(p))}</div>
            ${p.motivo_consulta ? `<div class="pac-card-motivo">${esc(p.motivo_consulta)}</div>` : ''}
            <div class="pac-card-meta">
              ${p.email    ? `<span><i class="fas fa-envelope" style="width:12px"></i> ${esc(p.email)}</span>` : ''}
              ${p.telefono ? `<span><i class="fas fa-phone"   style="width:12px"></i> ${esc(p.telefono)}</span>` : ''}
              ${p.terapeuta_nombre ? `<span><i class="fas fa-user-md" style="width:12px"></i> ${esc(p.terapeuta_nombre)}</span>` : ''}
            </div>
            <div style="display:flex;gap:8px;margin-top:6px;font-size:12px">
              <span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:10px">
                <i class="fas fa-calendar-check"></i> Total: <strong>${total}</strong>
              </span>
              <span style="background:${pendient>0?'var(--warning-light,#fff8e1)':'var(--success-light,#e8f5e9)'};color:${pendient>0?'var(--warning,#f59e0b)':'var(--success,#22c55e)'};padding:2px 8px;border-radius:10px">
                <i class="fas fa-hourglass-half"></i> Pendientes: <strong>${pendient}</strong>
              </span>
            </div>
            <div class="pac-card-footer">
              ${badge(p.estado, ESTADO_PACIENTE)}
              ${p.fuente ? `<span class="pac-fuente">${esc(p.fuente)}</span>` : ''}
            </div>
            ${window.__USER_ROL__ !== 'terapeuta' ? `
            <div class="pac-card-actions">
              ${p.tribu_user_id
                ? `<span class="pac-tribu-ok"><i class="fas fa-circle-check"></i> Usuario Tribu</span>`
                : p.email
                  ? `<button type="button" class="btn btn-outline btn-sm btn-tribu-create" data-tribu-create="${p.id}"><i class="fas fa-video"></i> Crear usuario Tribu</button>`
                  : `<span class="pac-tribu-muted" title="Requiere email"><i class="fas fa-envelope"></i> Sin email para Tribu</span>`
              }
            </div>` : ''}
          </div>`;
        }).join('')
        : '<div class="list-empty" style="grid-column:1/-1">Sin pacientes</div>';

      document.querySelectorAll('[data-edit]').forEach(btn =>
        btn.addEventListener('click', () => showPacienteForm(data.find(p => p.id == btn.dataset.edit)))
      );
      document.querySelectorAll('[data-ver]').forEach(btn =>
        btn.addEventListener('click', () => showPacienteDetalle(data.find(p => p.id == btn.dataset.ver)))
      );
      document.querySelectorAll('[data-tribu-create]').forEach(btn =>
        btn.addEventListener('click', () => crearUsuarioTribu(data.find(p => String(p.id) === btn.dataset.tribuCreate)))
      );
    } catch (err) { toast(err.message, 'danger'); }
  }

  async function crearUsuarioTribu(p) {
    if (!p?.id || p.tribu_user_id) return;
    if (!p.email) { toast('El paciente necesita email', 'danger'); return; }
    openModal('Crear usuario Tribu', `
      <p style="font-size:14px;margin-bottom:12px">Se creará acceso a <strong>La Tribu</strong> para:</p>
      <ul style="font-size:13px;color:var(--text-muted);margin:0 0 16px 18px;line-height:1.6">
        <li><strong>${esc(fullName(p))}</strong></li>
        <li>${esc(p.email)}</li>
        <li>Contraseña temporal (deberá cambiarla al ingresar)</li>
        <li>Suscripción activa S/ 89.90 · 1 año</li>
      </ul>
      <p style="font-size:12px;color:var(--text-muted)">El usuario deberá cambiar la contraseña al ingresar por primera vez.</p>
    `, async () => {
      const r = await api(`/pacientes/${p.id}/tribu-usuario`, { method: 'POST' });
      closeModal();
      setTimeout(() => {
        openModal('Usuario Tribu creado', `
          <div style="font-size:14px;line-height:1.6">
            <p><strong>${esc(fullName(p))}</strong> ya puede ingresar a La Tribu.</p>
            <div style="margin:14px 0;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm)">
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Correo</div>
              <div style="font-weight:600">${esc(r.email)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin:10px 0 4px">Contraseña temporal</div>
              <div style="font-family:monospace;font-size:18px;font-weight:700;letter-spacing:.08em;color:var(--primary)">${esc(r.tempPassword)}</div>
            </div>
            <p style="font-size:12px;color:var(--text-muted)">Comparte estos datos de forma segura. La contraseña debe cambiarse en el primer acceso.</p>
          </div>`, null);
        document.getElementById('modalSave').style.display = 'none';
        loadPacientes();
      }, 80);
    }, { saveLabel: 'Confirmar' });
  }

  /* ── Formulario ─────────────────────────────────────── */
  function sesionFila(sid, fecha, cant) {
    return `<tr data-sid="${sid}" style="border-top:1px solid var(--border)">
      <td style="padding:4px 6px"><input type="date" class="form-control ses-fecha" value="${esc(fecha)}" style="min-width:130px"></td>
      <td style="padding:4px 6px"><input type="number" min="0" step="1" class="form-control ses-cant" value="${cant}" placeholder="0" style="max-width:90px"></td>
      <td style="padding:4px 6px"><button type="button" class="btn-icon danger btn-del-sesion" title="Eliminar"><i class="fas fa-times"></i></button></td>
    </tr>`;
  }

  function bindDelSesion() {
    document.querySelectorAll('.btn-del-sesion').forEach(btn => {
      btn.onclick = () => {
        const fila = btn.closest('tr');
        if (fila.dataset.sid) { fila.dataset.deleted = '1'; fila.style.opacity = '0.3'; btn.disabled = true; }
        else fila.remove();
      };
    });
  }

  async function showPacienteForm(p = null) {
    if (!terapeutasCache.length) terapeutasCache = await api('/terapeutas').catch(() => []);
    const sesiones = p ? await api(`/pacientes/${p.id}/sesiones`).catch(() => []) : [];
    const tsOpts   = terapeutasCache.map(t =>
      `<option value="${t.id}" ${p?.terapeuta_id==t.id?'selected':''}>${esc(fullName(t))}</option>`).join('');
    const sesFilas = sesiones.length
      ? sesiones.map(s => sesionFila(s.id, s.fecha_inicio ? String(s.fecha_inicio).slice(0,10) : '', s.sesiones)).join('')
      : sesionFila('', '', '');

    openModal(p ? 'Editar paciente' : 'Nuevo paciente', `
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="f_nombre" value="${esc(p?.nombre||'')}"></div>
        <div class="form-group"><label class="form-label">Apellido *</label><input class="form-control" id="f_apellido" value="${esc(p?.apellido||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-control" id="f_email" value="${esc(p?.email||'')}"></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="f_telefono" value="${esc(p?.telefono||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fecha de nacimiento</label><input type="date" class="form-control" id="f_nacimiento" value="${p?.fecha_nacimiento?String(p.fecha_nacimiento).slice(0,10):''}"></div>
        <div class="form-group"><label class="form-label">Género</label>
          <select class="form-select" id="f_genero">
            <option value="">— Sin especificar —</option>
            ${['masculino','femenino','otro','prefiero_no_decir'].map(g =>
              `<option value="${g}" ${p?.genero===g?'selected':''}>${g}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Estado</label>
          <select class="form-select" id="f_estado">
            ${Object.entries(ESTADO_PACIENTE).map(([k,v]) =>
              `<option value="${k}" ${(p?.estado||'prospecto')===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Terapeuta</label>
          <select class="form-select" id="f_terapeuta_id"><option value="">— Sin asignar —</option>${tsOpts}</select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Fuente</label>
        <select class="form-select" id="f_fuente">
          <option value="">— Sin especificar —</option>
          ${['instagram','tiktok','web','whatsapp','referido','otro'].map(f =>
            `<option value="${f}" ${p?.fuente===f?'selected':''}>${f}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Motivo de consulta</label><textarea class="form-control" id="f_motivo" rows="2">${esc(p?.motivo_consulta||'')}</textarea></div>
      <div class="form-group">
        <label class="form-label" style="margin-bottom:6px">Programa adquirido</label>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="font-size:12px;color:var(--text-muted)"><th style="padding:4px 6px;text-align:left">Fecha inicio</th><th style="padding:4px 6px;text-align:left">Sesiones</th><th style="width:32px"></th></tr></thead>
          <tbody id="sesionesBody">${sesFilas}</tbody>
        </table>
        <button type="button" class="btn btn-outline btn-sm" id="btnAddSesion" style="margin-top:6px"><i class="fas fa-plus"></i> Agregar fila</button>
      </div>`, async () => {
      const body = {
        nombre:           document.getElementById('f_nombre').value,
        apellido:         document.getElementById('f_apellido').value,
        email:            document.getElementById('f_email').value,
        telefono:         document.getElementById('f_telefono').value,
        fecha_nacimiento: document.getElementById('f_nacimiento').value || null,
        genero:           document.getElementById('f_genero').value || null,
        estado:           document.getElementById('f_estado').value,
        terapeuta_id:     document.getElementById('f_terapeuta_id').value || null,
        fuente:           document.getElementById('f_fuente').value || null,
        motivo_consulta:  document.getElementById('f_motivo').value,
      };
      if (!body.nombre || !body.apellido) throw new Error('Nombre y apellido requeridos');
      let pid = p?.id;
      if (p) { await api(`/pacientes/${p.id}`, { method: 'PUT', body }); }
      else   { const r = await api('/pacientes', { method: 'POST', body }); pid = r.id; }
      for (const fila of document.querySelectorAll('#sesionesBody tr[data-sid]')) {
        const sid   = fila.dataset.sid;
        const fecha = fila.querySelector('.ses-fecha').value || null;
        const cant  = parseInt(fila.querySelector('.ses-cant').value, 10) || 0;
        if (fila.dataset.deleted === '1') {
          if (sid) await api(`/pacientes/${pid}/sesiones/${sid}`, { method: 'DELETE' }).catch(() => {});
        } else if (sid) {
          await api(`/pacientes/${pid}/sesiones/${sid}`, { method: 'PUT', body: { fecha_inicio: fecha, sesiones: cant } }).catch(() => {});
        } else {
          await api(`/pacientes/${pid}/sesiones`, { method: 'POST', body: { fecha_inicio: fecha, sesiones: cant } }).catch(() => {});
        }
      }
      toast(p ? 'Paciente actualizado' : 'Paciente creado');
      loadPacientes();
    }, { large: true });

    document.getElementById('btnAddSesion')?.addEventListener('click', () => {
      document.getElementById('sesionesBody').insertAdjacentHTML('beforeend', sesionFila('', '', ''));
      bindDelSesion();
    });
    bindDelSesion();
  }

  /* ── Detalle ────────────────────────────────────────── */
  function showPacienteDetalle(p) {
    if (!p) return;
    openModal(fullName(p), `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
        <div><span style="color:var(--text-muted)">Email:</span> ${esc(p.email||'—')}</div>
        <div><span style="color:var(--text-muted)">Teléfono:</span> ${esc(p.telefono||'—')}</div>
        <div><span style="color:var(--text-muted)">Estado:</span> ${badge(p.estado, ESTADO_PACIENTE)}</div>
        <div><span style="color:var(--text-muted)">Terapeuta:</span> ${esc(p.terapeuta_nombre||'—')}</div>
        <div><span style="color:var(--text-muted)">Fuente:</span> ${esc(p.fuente||'—')}</div>
        <div><span style="color:var(--text-muted)">Registro:</span> ${fmtDate(p.created_at)}</div>
      </div>
      ${p.motivo_consulta ? `<div style="margin-top:12px"><strong>Motivo:</strong><p style="margin-top:4px;font-size:13px">${esc(p.motivo_consulta)}</p></div>` : ''}
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-outline btn-sm" href="${window.__APP_BASE__}/historial"><i class="fas fa-file-medical"></i> Ver historial</a>
        <a class="btn btn-outline btn-sm" href="${window.__APP_BASE__}/agenda"><i class="fas fa-calendar"></i> Ver agenda</a>
      </div>`, null);
    document.getElementById('modalSave').style.display = 'none';
  }

  /* ── Listeners ──────────────────────────────────────── */
  let searchTimer;
  document.getElementById('buscarPaciente').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPacientes, 300);
  });
  document.getElementById('filtroPacienteEstado').addEventListener('change', loadPacientes);
  document.getElementById('btnNuevoPaciente')?.addEventListener('click', () => showPacienteForm());

  /* ── Init ───────────────────────────────────────────── */
  bindChips();
  loadPacientes();

})();
