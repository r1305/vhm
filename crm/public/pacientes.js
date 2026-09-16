/* ═══════════════════════════════════════════════════════
   VHM CRM — pacientes.js
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { api, toast, esc, fmtDate, badge, fullName,
          openModal, closeModal, ESTADO_PACIENTE } = window.CRM;

  let terapeutasCache = [];
  let chipTerapeutaId = null;
  let filtroSinTel    = false;
  let filtroSinEmail  = false;

  /* ── Chips calidad de datos ─────────────────────────── */
  function bindFiltroChips() {
    document.getElementById('chipSinTel').addEventListener('click', function () {
      filtroSinTel = !filtroSinTel;
      this.classList.toggle('active', filtroSinTel);
      loadPacientes();
    });
    document.getElementById('chipSinEmail').addEventListener('click', function () {
      filtroSinEmail = !filtroSinEmail;
      this.classList.toggle('active', filtroSinEmail);
      loadPacientes();
    });
  }

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
      if (filtroSinTel)   qs.set('sin_telefono', '1');
      if (filtroSinEmail) qs.set('sin_email', '1');
      const data = await api(`/pacientes?${qs}`, { loaderMessage: 'Cargando pacientes…' });
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
              ${p.paquete_nombre ? `<span><i class="fas fa-box" style="width:12px"></i> ${esc(p.paquete_nombre)}${Number(p.paquetes_total) > 1 ? ` (+${Number(p.paquetes_total) - 1} más)` : ''}</span>` : ''}
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
        <li>Suscripción activa · 1 año</li>
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
  function fmtMoney(n) {
    return 'S/ ' + Number(n || 0).toFixed(2);
  }

  function renderCuotasPreview(catalogo, tipoPago, numCuotas, fechaInicio) {
    if (!catalogo || !window.CuotasPlan) return '';
    const plan = window.CuotasPlan.buildCuotasPlan({
      precio: catalogo.precio,
      sesiones: catalogo.sesiones,
      diasSiguienteCuota: catalogo.dias_siguiente_cuota,
      fechaInicio,
      numCuotas,
      tipoPago,
    });
    if (!plan.length) return '';
    const totalPrecio = plan.reduce((sum, c) => sum + Number(c.monto), 0);
    const diasCuota = window.CuotasPlan.normalizeDiasSiguienteCuota(catalogo.dias_siguiente_cuota);
    let html = `<div class="pkg-cuotas-preview">
      <div class="pkg-cuota-preview-summary">${plan.length} cuota${plan.length > 1 ? 's' : ''} · Total ${fmtMoney(totalPrecio)}${tipoPago === 'parcial' ? ` · cada ${diasCuota} días` : ''}</div>`;
    for (const cuota of plan) {
      const sesLabel = cuota.sesiones_inicio === cuota.sesiones_fin
        ? `Sesión ${cuota.sesiones_inicio}`
        : `Sesiones ${cuota.sesiones_inicio}–${cuota.sesiones_fin}`;
      html += `<div class="pkg-cuota-preview-item">
        <strong>Cuota ${cuota.numero}</strong> · ${fmtMoney(cuota.monto)} · pago ${cuota.fecha_pago}
        <span class="pkg-cuota-ses">${sesLabel} (${cuota.sesiones_fin - cuota.sesiones_inicio + 1} ses.)</span>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  function addDaysPreview(dateStr, days) {
    const d = new Date((dateStr || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const ESTADO_PAQUETE = {
    activo:    { label: 'Activo',    cls: 'activo' },
    pendiente:   { label: 'En cola',       cls: 'pendiente' },
    vencido:     { label: 'Vencido',       cls: 'vencido' },
    agotado:     { label: 'Agotado',       cls: 'agotado' },
    reemplazado: { label: 'Reemplazado',   cls: 'inactivo' },
    inactivo:    { label: 'Inactivo',      cls: 'inactivo' },
  };

  function renderCuotasPaquete(paquete, pid) {
    return (paquete.cuotas || []).map((c) => `
      <div class="pkg-cuota-row ${c.pagado ? 'pagada' : ''}">
        <div>
          <strong>Cuota ${c.numero}</strong> · ${fmtMoney(c.monto)}
          <div class="pkg-cuota-meta">Pago: ${String(c.fecha_pago).slice(0, 10)} · ${c.sesiones_inicio === c.sesiones_fin ? `Sesión ${c.sesiones_inicio}` : `Sesiones ${c.sesiones_inicio}–${c.sesiones_fin}`} (${c.sesiones_fin - c.sesiones_inicio + 1} ses.)</div>
        </div>
        ${c.pagado
          ? '<span class="badge badge-green">Pagada</span>'
          : `<button type="button" class="btn btn-outline btn-xs" data-pagar-cuota="${c.id}" data-pid="${pid}">Marcar pagada</button>`}
      </div>`).join('');
  }

  function renderHistorialPaquetes(paquetes, pid) {
    if (!paquetes.length) {
      return '<p style="font-size:13px;color:var(--text-muted)">Sin paquetes adquiridos.</p>';
    }
    return `<div class="pkg-historial">${paquetes.map((pkg) => {
      const est = ESTADO_PAQUETE[pkg.estado] || ESTADO_PAQUETE.inactivo;
      const usadas = Number(pkg.sesiones_usadas) || 0;
      const restantes = Number(pkg.sesiones_restantes) || 0;
      const cuotasId = `pkg-cuotas-${pkg.id}`;
      return `
        <div class="pkg-historial-item estado-${pkg.estado}">
          <div class="pkg-historial-header">
            <div class="pkg-historial-title">${esc(pkg.nombre)}</div>
            <span class="pkg-estado-badge ${est.cls}">${est.label}</span>
          </div>
          <div class="pkg-historial-meta">
            ${fmtMoney(pkg.precio)} · ${pkg.sesiones} sesiones (${usadas} usadas, ${restantes} restantes)<br>
            Inicio: ${String(pkg.fecha_inicio).slice(0, 10)} · Vence: ${String(pkg.vence_at || '').slice(0, 10)}<br>
            ${pkg.tipo_pago === 'parcial'
              ? `${pkg.num_cuotas} cuotas · cada ${pkg.dias_siguiente_cuota || 15} días`
              : 'Pago total'}
          </div>
          ${(pkg.cuotas || []).length ? `
            <button type="button" class="pkg-cuotas-toggle" data-toggle-cuotas="${cuotasId}">
              <i class="fas fa-chevron-down"></i> Ver cuotas (${pkg.cuotas.filter((c) => c.pagado).length}/${pkg.cuotas.length} pagadas)
            </button>
            <div class="pkg-cuotas-collapsed" id="${cuotasId}">${renderCuotasPaquete(pkg, pid)}</div>
          ` : ''}
        </div>`;
    }).join('')}</div>`;
  }

  function bindPaqueteEvents(pid, catalogo) {
    const tipo = document.getElementById('pkg_tipo_pago');
    const cuotas = document.getElementById('pkg_cuotas');
    const cat = document.getElementById('pkg_catalogo');
    const fecha = document.getElementById('pkg_fecha');
    const preview = document.getElementById('pkg_cuotas_preview');

    function refreshPreview() {
      const selected = catalogo.find((x) => String(x.id) === cat.value);
      const esParcial = tipo.value === 'parcial';
      if (esParcial) {
        const maxCuotas = selected ? Math.max(2, Number(selected.sesiones) || 2) : 99;
        cuotas.disabled = false;
        cuotas.min = 2;
        cuotas.max = maxCuotas;
        if (Number(cuotas.value) < 2) cuotas.value = '2';
        if (Number(cuotas.value) > maxCuotas) cuotas.value = String(maxCuotas);
      } else {
        cuotas.disabled = true;
        cuotas.min = 1;
        cuotas.max = 1;
        cuotas.value = '1';
      }
      preview.innerHTML = selected
        ? renderCuotasPreview(selected, tipo.value, cuotas.value, fecha.value)
        : '';
    }

    tipo?.addEventListener('change', refreshPreview);
    cuotas?.addEventListener('input', refreshPreview);
    cat?.addEventListener('change', refreshPreview);
    fecha?.addEventListener('change', refreshPreview);
    refreshPreview();

    document.querySelectorAll('[data-pagar-cuota]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cuotaId = btn.dataset.pagarCuota;
        const patientId = btn.dataset.pid;
        try {
          const r = await api(`/pacientes/${patientId}/paquetes-adquiridos/cuotas/${cuotaId}/pagar`, {
            method: 'PATCH',
            successMessage: 'Cuota marcada como pagada',
          });
          document.getElementById('paqueteHistorialBox').innerHTML = renderHistorialPaquetes(r.paquetes || [], patientId);
          bindPaqueteEvents(patientId, catalogo);
        } catch (e) {
          toast(e.message, 'danger');
        }
      });
    });

    document.querySelectorAll('[data-toggle-cuotas]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.dataset.toggleCuotas);
        if (!el) return;
        const open = el.classList.toggle('open');
        btn.innerHTML = open
          ? `<i class="fas fa-chevron-up"></i> Ocultar cuotas`
          : btn.innerHTML.replace('Ocultar cuotas', 'Ver cuotas').replace('fa-chevron-up', 'fa-chevron-down');
      });
    });
  }

  async function showPacienteForm(p = null) {
    window.showCrmLoader?.('Cargando datos…');
    let catalogo = [];
    let paquetesPac = [];
    try {
      if (!terapeutasCache.length) terapeutasCache = await api('/terapeutas', { loader: false }).catch(() => []);
      catalogo = await api('/paquetes?activo=1', { loader: false }).catch(() => []);
      paquetesPac = p
        ? await api(`/pacientes/${p.id}/paquetes-adquiridos`, { loader: false }).catch(() => [])
        : [];
    } finally {
      window.hideCrmLoader?.();
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const paqueteActivo = paquetesPac.find((x) => x.estado === 'activo') || null;
    const bloquearCompra = paqueteActivo?.estado === 'activo';
    const fechaSugerida = hoy;
    const tsOpts   = terapeutasCache.map(t =>
      `<option value="${t.id}" ${p?.terapeuta_id==t.id?'selected':''}>${esc(fullName(t))}</option>`).join('');
    const catOpts = catalogo.length
      ? catalogo.map((c) => `<option value="${c.id}">${esc(c.nombre)} — ${c.sesiones} ses. — ${fmtMoney(c.precio)}</option>`).join('')
      : '<option value="">No hay paquetes activos</option>';

    openModal(p ? 'Editar paciente' : 'Nuevo paciente', `
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="f_nombre" value="${esc(p?.nombre||'')}"></div>
        <div class="form-group"><label class="form-label">Apellido *</label><input class="form-control" id="f_apellido" value="${esc(p?.apellido||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-control" id="f_email" value="${esc(p?.email||'')}"></div>
        <div class="form-group">
          <label class="form-label">Teléfono <span style="font-size:11px;color:var(--text-muted);font-weight:400">con código de país</span></label>
          <input class="form-control" id="f_telefono" value="${esc(p?.telefono||'')}" placeholder="51999999999" inputmode="numeric">
          <span style="font-size:11px;color:var(--text-muted);margin-top:3px;display:block">Ej: 51999999999 (Perú) · 15551234567 (EE.UU.) · 34612345678 (España)</span>
        </div>
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
        <label class="form-label">Historial de paquetes ${paquetesPac.length ? `(${paquetesPac.length})` : ''}</label>
        <div id="paqueteHistorialBox">${renderHistorialPaquetes(paquetesPac, p?.id)}</div>
      </div>
      <div class="form-group pkg-asignar-box">
        <label class="form-label">Adquirir nuevo paquete</label>
        ${bloquearCompra ? `
          <div class="pkg-compra-bloqueada">
            <i class="fas fa-circle-info"></i>
            No se puede adquirir otro paquete: <strong>${esc(paqueteActivo.nombre)}</strong> está activo con
            <strong>${paqueteActivo.sesiones_restantes}</strong> sesión${paqueteActivo.sesiones_restantes !== 1 ? 'es' : ''} disponible${paqueteActivo.sesiones_restantes !== 1 ? 's' : ''}.
          </div>` : `
        <select class="form-select" id="pkg_catalogo"><option value="">— Seleccionar paquete —</option>${catOpts}</select>
        <div class="form-row" style="margin-top:8px">
          <div class="form-group"><label class="form-label">Fecha inicio</label><input type="date" class="form-control" id="pkg_fecha" value="${fechaSugerida}"></div>
          <div class="form-group"><label class="form-label">Tipo de pago</label>
            <select class="form-select" id="pkg_tipo_pago"><option value="total">Total</option><option value="parcial">Parcial</option></select>
          </div>
          <div class="form-group"><label class="form-label">Cuotas</label>
            <input type="number" min="1" max="1" class="form-control" id="pkg_cuotas" value="1" disabled></div>
        </div>
        <div id="pkg_cuotas_preview"></div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:6px">El paquete seleccionado se activará al guardar.</p>`}
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
      if (body.telefono) {
        body.telefono = body.telefono.replace(/[\s+()\-]/g, '');
        if (!/^\d{10,15}$/.test(body.telefono)) throw new Error('Teléfono inválido — ingresa solo dígitos con código de país (10-15 dígitos). Ej: 51999999999');
      }
      let pid = p?.id;
      if (p) { await api(`/pacientes/${p.id}`, { method: 'PUT', body }); }
      else   { const r = await api('/pacientes', { method: 'POST', body }); pid = r.id; }

      const catalogoId = document.getElementById('pkg_catalogo')?.value;
      if (catalogoId) {
        const tipoPago = document.getElementById('pkg_tipo_pago').value;
        const numCuotas = parseInt(document.getElementById('pkg_cuotas').value, 10);
        if (tipoPago === 'parcial' && (!numCuotas || numCuotas < 2)) {
          throw new Error('El pago parcial requiere al menos 2 cuotas');
        }
        await api(`/pacientes/${pid}/paquetes-adquiridos`, {
          method: 'POST',
          body: {
            paquete_catalogo_id: catalogoId,
            fecha_inicio: document.getElementById('pkg_fecha').value,
            tipo_pago: tipoPago,
            num_cuotas: tipoPago === 'parcial' ? numCuotas : 1,
          },
        });
      }

      loadPacientes();
    }, { large: true, successMessage: p ? 'Paciente actualizado' : 'Paciente creado' });

    if (!bloquearCompra) bindPaqueteEvents(p?.id, catalogo);
  }

  /* ── Detalle ────────────────────────────────────────── */
  async function showPacienteDetalle(p) {
    if (!p) return;
    let paquetesPac = [];
    try {
      paquetesPac = await api(`/pacientes/${p.id}/paquetes-adquiridos`, { loaderMessage: 'Cargando historial…' });
    } catch {
      paquetesPac = [];
    }
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
      <div style="margin-top:14px">
        <strong style="font-size:13px">Historial de paquetes</strong>
        <div style="margin-top:8px">${renderHistorialPaquetes(paquetesPac, p.id)}</div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-outline btn-sm" href="${window.__APP_BASE__}/historial"><i class="fas fa-file-medical"></i> Ver historial clínico</a>
        <a class="btn btn-outline btn-sm" href="${window.__APP_BASE__}/agenda"><i class="fas fa-calendar"></i> Ver agenda</a>
      </div>`, null);
    document.getElementById('modalSave').style.display = 'none';
    document.querySelectorAll('[data-toggle-cuotas]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.dataset.toggleCuotas);
        if (!el) return;
        const open = el.classList.toggle('open');
        btn.innerHTML = open
          ? `<i class="fas fa-chevron-up"></i> Ocultar cuotas`
          : `<i class="fas fa-chevron-down"></i> Ver cuotas`;
      });
    });
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
  bindFiltroChips();
  bindChips();
  loadPacientes();

})();
