/* ═══════════════════════════════════════════════════════
   VHM CRM — part2.js  Dashboard · Agenda · Pacientes
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* esperamos a que CRM esté listo */
  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fmtMoney, badge, fullName,
            openModal, closeModal, viewLoaders, showLoading,
            ESTADO_PACIENTE, ESTADO_CITA, FUENTE_ICON,
            getUser, isAdmin } = window.CRM;

    /* ══════════════════════════════════════════════════
       DASHBOARD
    ══════════════════════════════════════════════════ */
    async function loadDashboard() {
      try {
        showLoading(document.getElementById('kpiGrid'), true);
        const d = await api('/reportes/dashboard');
        showLoading(document.getElementById('kpiGrid'), false);
        const k = d.kpis || {};

        document.getElementById('kpiGrid').innerHTML = `
          <div class="kpi-card accent">
            <div class="kpi-label">Pacientes activos</div>
            <div class="kpi-value">${k.pacientes_activos || 0}</div>
            <div class="kpi-sub">${k.prospectos || 0} prospectos</div>
          </div>
          <div class="kpi-card success">
            <div class="kpi-label">Citas hoy</div>
            <div class="kpi-value">${k.citas_hoy || 0}</div>
            <div class="kpi-sub">${k.citas_semana || 0} esta semana</div>
          </div>
          <div class="kpi-card warning">
            <div class="kpi-label">Leads nuevos</div>
            <div class="kpi-value">${k.leads_nuevos || 0}</div>
          </div>
          <div class="kpi-card info">
            <div class="kpi-label">Ingresos mes</div>
            <div class="kpi-value" style="font-size:1.2rem">${fmtMoney(k.ingresos_mes)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Lista de espera</div>
            <div class="kpi-value">${k.lista_espera || 0}</div>
          </div>`;

        document.getElementById('citasHoyList').innerHTML = (d.citasHoy || []).length
          ? d.citasHoy.map(c => `
            <div class="list-item">
              <div class="list-icon"><i class="fas fa-clock"></i></div>
              <div class="flex-grow-1">
                <div class="list-title">${esc(c.hora_inicio?.slice(0,5))} — ${esc(fullName(c))}</div>
                <div class="list-meta">${esc(c.terapeuta_nombre)} · ${esc(c.modalidad)}</div>
              </div>
              ${badge(c.estado, ESTADO_CITA)}
            </div>`).join('')
          : '<div class="list-empty">Sin citas hoy</div>';

        /* leads recientes */
        const leads = await api('/leads?limit=6');
        document.getElementById('leadsRecentesList').innerHTML = (leads || []).length
          ? leads.map(l => `
            <div class="list-item">
              <div class="list-icon"><i class="${FUENTE_ICON[l.fuente] || 'fas fa-circle-dot'}"></i></div>
              <div class="flex-grow-1">
                <div class="list-title">${esc(fullName(l) || 'Sin nombre')}</div>
                <div class="list-meta">${esc(l.fuente_detalle || l.fuente)} · ${fmtDate(l.created_at)}</div>
              </div>
              ${badge(l.estado, window.CRM.ESTADO_LEAD)}
            </div>`).join('')
          : '<div class="list-empty">Sin leads recientes</div>';

      } catch (err) { toast(err.message, 'danger'); }
    }
    viewLoaders['dashboard'] = loadDashboard;

    /* ══════════════════════════════════════════════════
       AGENDA
    ══════════════════════════════════════════════════ */
    let agendaFechaActual = new Date();
    let agendaTerapeutaId = null;
    let pacientesCache = [];

    function buildCalStrip() {
      const strip = document.getElementById('calStrip');
      const hoy   = new Date();
      const dias  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
      strip.innerHTML = '';

      const esMesActual = agendaFechaActual.getFullYear() === hoy.getFullYear() &&
                          agendaFechaActual.getMonth()    === hoy.getMonth();

      // Para mes actual: ventana -2..+9. Para mes anterior: todos los días del mes.
      let fechas = [];
      if (esMesActual) {
        for (let i = -2; i <= 9; i++) {
          const d = new Date(agendaFechaActual);
          d.setDate(agendaFechaActual.getDate() + i);
          fechas.push(d);
        }
      } else {
        const anio = agendaFechaActual.getFullYear();
        const mes  = agendaFechaActual.getMonth();
        const total = new Date(anio, mes + 1, 0).getDate();
        for (let day = 1; day <= total; day++) fechas.push(new Date(anio, mes, day));
      }

      fechas.forEach(d => {
        const iso = localDateISO(d);
        const isActual = iso === localDateISO(agendaFechaActual);
        const div = document.createElement('div');
        div.className = `cal-day${isActual ? ' active' : ''}`;
        div.dataset.fecha = iso;
        div.innerHTML = `<div class="day-name">${dias[d.getDay()]}</div><div class="day-num">${d.getDate()}</div>`;
        div.addEventListener('click', () => {
          document.querySelectorAll('.cal-day').forEach(c => c.classList.remove('active'));
          div.classList.add('active');
          agendaFechaActual = d;
          syncMesSelect();
          loadAgenda();
        });
        strip.appendChild(div);
      });
    }

    function syncMesSelect() {
      const sel = document.getElementById('agendaMes');
      if (!sel) return;
      const val = `${agendaFechaActual.getFullYear()}-${String(agendaFechaActual.getMonth() + 1).padStart(2,'0')}`;
      if (sel.value !== val) sel.value = val;
    }

    function buildMesSelect() {
      const sel = document.getElementById('agendaMes');
      if (!sel) return;
      const hoy    = new Date();
      const anio   = hoy.getFullYear();
      const mesMax = hoy.getMonth(); // 0-based
      const MESES  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      sel.innerHTML = '';
      for (let m = 0; m <= mesMax; m++) {
        const val = `${anio}-${String(m + 1).padStart(2,'0')}`;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `${MESES[m]} ${anio}`;
        sel.appendChild(opt);
      }
      syncMesSelect();
    }

    async function loadAgenda() {
      try {
        const fecha = agendaFechaActual.toISOString().slice(0,10);
        const qs = new URLSearchParams({ fecha });
        if (agendaTerapeutaId) qs.set('terapeuta_id', agendaTerapeutaId);
        const citas = await api(`/citas?${qs}`);
        const tl = document.getElementById('agendaTimeline');
        tl.innerHTML = citas.length
          ? citas.map(c => `
            <div class="timeline-item">
              <div class="timeline-time">${esc(c.hora_inicio?.slice(0,5))}</div>
              <div class="timeline-body">
                <div class="timeline-name">${esc(c.paciente_nombre||'')} ${esc(c.paciente_apellido||'')}</div>
                <div class="timeline-sub">${esc(c.terapeuta_nombre)} · ${esc(c.tipo)} · ${esc(c.modalidad)}</div>
              </div>
              ${badge(c.estado, ESTADO_CITA)}
              <div style="display:flex;gap:4px;margin-left:8px">
                <button class="btn-icon" data-cita-estado="${c.id}" data-actual="${c.estado}" title="Cambiar estado"><i class="fas fa-pen"></i></button>
                <button class="btn-icon" data-send-rec="${c.id}" title="Enviar recordatorio"><i class="fas fa-bell"></i></button>
                ${c.estado !== 'realizada' ? `<button class="btn-icon" style="color:var(--success)" data-confirmar-cita="${c.id}" title="Marcar como realizada"><i class="fas fa-circle-check"></i></button>` : ''}
                ${c.estado !== 'cancelada' ? `<button class="btn-icon" style="color:var(--danger)" data-cancelar-cita="${c.id}" title="Cancelar sesión"><i class="fas fa-circle-xmark"></i></button>` : ''}
              </div>
            </div>`).join('')
          : '<div class="list-empty">Sin citas para este día</div>';

        tl.querySelectorAll('[data-cita-estado]').forEach(btn => {
          btn.addEventListener('click', () => showCambioEstadoCita(btn.dataset.citaEstado, btn.dataset.actual));
        });
        tl.querySelectorAll('[data-send-rec]').forEach(btn => {
          btn.addEventListener('click', async () => {
            try { await api(`/citas/${btn.dataset.sendRec}/recordatorio`, { method: 'POST' }); toast('Recordatorio enviado'); }
            catch (e) { toast(e.message, 'danger'); }
          });
        });
        tl.querySelectorAll('[data-confirmar-cita]').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await api(`/citas/${btn.dataset.confirmarCita}/estado`, { method: 'PATCH', body: { estado: 'realizada' } });
              toast('Sesión marcada como realizada');
              loadAgenda();
            } catch (e) { toast(e.message, 'danger'); }
          });
        });
        tl.querySelectorAll('[data-cancelar-cita]').forEach(btn => {
          btn.addEventListener('click', () => {
            openModal('Cancelar sesión', `
              <div class="form-group">
                <label class="form-label">Motivo de cancelación *</label>
                <textarea class="form-control" id="f_motivo_cancelacion" rows="3" placeholder="Indica el motivo de la cancelación…"></textarea>
              </div>`, async () => {
              const motivo = document.getElementById('f_motivo_cancelacion').value.trim();
              if (!motivo) throw new Error('Debes ingresar un motivo de cancelación');
              await api(`/citas/${btn.dataset.cancelarCita}/estado`, { method: 'PATCH', body: { estado: 'cancelada', notas: motivo } });
              toast('Sesión cancelada');
              loadAgenda();
            });
          });
        });
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function loadAgendaTerapeutas() {
      try {
        const ts = await api('/terapeutas');
        const sel = document.getElementById('agendaTerapeuta');
        sel.innerHTML = `<option value="">Todos los terapeutas</option>` +
          ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        if (!isAdmin() && getUser()) {
          sel.value = getUser().id;
          agendaTerapeutaId = getUser().id;
        }
      } catch {}
    }

    document.getElementById('agendaTerapeuta').addEventListener('change', e => {
      agendaTerapeutaId = e.target.value || null;
      loadAgenda();
    });

    document.getElementById('agendaMes')?.addEventListener('change', e => {
      const [anio, mes] = e.target.value.split('-').map(Number);
      // ir al primer día del mes seleccionado (o hoy si es el mes actual)
      const hoy = new Date();
      const esActual = anio === hoy.getFullYear() && mes - 1 === hoy.getMonth();
      agendaFechaActual = esActual ? hoy : new Date(anio, mes - 1, 15);
      buildCalStrip();
      loadAgenda();
    });

    function localDateISO(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function showNuevaCita() {
      const hoy = localDateISO(new Date());
      openModal('Nueva cita', `
        <div class="form-group" style="position:relative">
          <label class="form-label">Paciente *</label>
          <input class="form-control" id="f_paciente_search" autocomplete="off" placeholder="Buscar paciente…">
          <input type="hidden" id="f_paciente_id">
          <div id="f_paciente_dropdown" class="autocomplete-dropdown" style="display:none"></div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Terapeuta *</label>
            <select class="form-select" id="f_terapeuta_id"></select>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha *</label>
            <input type="date" class="form-control" id="f_fecha" value="${hoy}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Hora inicio *</label>
            <input type="time" class="form-control" id="f_hora_inicio">
          </div>
          <div class="form-group">
            <label class="form-label">Hora fin *</label>
            <input type="time" class="form-control" id="f_hora_fin">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Modalidad</label>
            <select class="form-select" id="f_modalidad">
              <option value="presencial">Presencial</option>
              <option value="videollamada" selected>Videollamada</option>
              <option value="telefono">Teléfono</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-select" id="f_tipo">
              <option value="primera_vez">Primera vez</option>
              <option value="seguimiento" selected>Seguimiento</option>
              <option value="evaluacion">Evaluación</option>
              <option value="urgencia">Urgencia</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notas</label>
          <textarea class="form-control" id="f_notas" rows="2"></textarea>
        </div>`, async () => {
        const body = {
          paciente_id:  document.getElementById('f_paciente_id').value,
          terapeuta_id: document.getElementById('f_terapeuta_id').value,
          fecha:        document.getElementById('f_fecha').value,
          hora_inicio:  document.getElementById('f_hora_inicio').value,
          hora_fin:     document.getElementById('f_hora_fin').value,
          modalidad:    document.getElementById('f_modalidad').value,
          tipo:         document.getElementById('f_tipo').value,
          notas:        document.getElementById('f_notas').value,
        };
        if (!body.paciente_id || !body.terapeuta_id || !body.fecha || !body.hora_inicio || !body.hora_fin)
          throw new Error('Completa todos los campos requeridos');
        await api('/citas', { method: 'POST', body });
        toast('Cita creada');
        loadAgenda();
      });

      // Cargar terapeutas
      let terapeutasList = [];
      api('/terapeutas').then(ts => {
        terapeutasList = ts;
        const sel = document.getElementById('f_terapeuta_id');
        if (!sel) return;
        sel.innerHTML = ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        if (!isAdmin()) sel.value = getUser()?.id;
      }).catch(() => {});

      // Autocomplete paciente
      const searchInput = document.getElementById('f_paciente_search');
      const hiddenId    = document.getElementById('f_paciente_id');
      const dropdown    = document.getElementById('f_paciente_dropdown');

      function renderDropdown(q) {
        const q2 = q.toLowerCase();
        const matches = pacientesCache.filter(p =>
          fullName(p).toLowerCase().includes(q2) ||
          (p.telefono || '').includes(q2) ||
          (p.email || '').toLowerCase().includes(q2)
        ).slice(0, 10);
        if (!matches.length) { dropdown.style.display = 'none'; return; }
        dropdown.innerHTML = matches.map(p =>
          `<div class="autocomplete-item" data-pid="${p.id}" data-tid="${p.terapeuta_id || ''}">
            <strong>${esc(fullName(p))}</strong>
            ${p.terapeuta_nombre ? `<span> — ${esc(p.terapeuta_nombre)}</span>` : ''}
          </div>`
        ).join('');
        dropdown.style.display = 'block';
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('mousedown', e => {
            e.preventDefault();
            hiddenId.value = item.dataset.pid;
            searchInput.value = item.querySelector('strong').textContent;
            dropdown.style.display = 'none';
            const tid = item.dataset.tid;
            const sel = document.getElementById('f_terapeuta_id');
            if (tid && sel) sel.value = tid;
          });
        });
      }

      searchInput?.addEventListener('input', e => {
        hiddenId.value = '';
        const q = e.target.value.trim();
        if (q.length < 1) { dropdown.style.display = 'none'; return; }
        renderDropdown(q);
      });
      searchInput?.addEventListener('focus', e => {
        if (e.target.value.trim()) renderDropdown(e.target.value.trim());
      });
      searchInput?.addEventListener('blur', () => {
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
      });

      // Al cambiar hora inicio: calcular hora fin (+1h)
      document.getElementById('f_hora_inicio')?.addEventListener('change', e => {
        const val = e.target.value;
        if (!val) return;
        const [h, m] = val.split(':').map(Number);
        const fin = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        document.getElementById('f_hora_fin').value = fin;
      });
    }

    function showCambioEstadoCita(id, actual) {
      openModal('Cambiar estado', `
        <div class="form-group">
          <label class="form-label">Nuevo estado</label>
          <select class="form-select" id="f_estado_cita">
            ${Object.entries(ESTADO_CITA).map(([k, v]) =>
              `<option value="${k}" ${k === actual ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>`, async () => {
        await api(`/citas/${id}/estado`, { method: 'PATCH', body: { estado: document.getElementById('f_estado_cita').value } });
        toast('Estado actualizado');
        loadAgenda();
      });
    }

    document.getElementById('btnNuevaCita').addEventListener('click', showNuevaCita);

    viewLoaders['agenda'] = async () => {
      if (!pacientesCache.length) {
        const ps = await api('/pacientes').catch(() => []);
        pacientesCache = ps;
      }
      buildMesSelect();
      buildCalStrip();
      await loadAgendaTerapeutas();
      await loadAgenda();
    };

    /* ══════════════════════════════════════════════════
       PACIENTES
    ══════════════════════════════════════════════════ */
    let terapeutasCache = [];
    let chipTerapeutaId = null;

    async function loadTerapeutaChips() {
      await ensureTerapeutasCache();
      const conteo = await api('/pacientes/conteo-por-terapeuta').catch(() => ({}));
      const bar = document.getElementById('terapeutaChips');
      bar.innerHTML = terapeutasCache.map(t => `
        <button class="chip" data-chip-id="${t.id}">${esc(fullName(t))} (${conteo[t.id] || 0})</button>
      `).join('');
      bar.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.chipId);
          if (chipTerapeutaId === id) {
            chipTerapeutaId = null;
            btn.classList.remove('active');
          } else {
            chipTerapeutaId = id;
            bar.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
          }
          loadPacientes();
        });
      });
    }

    async function loadPacientes() {
      try {
        const q      = document.getElementById('buscarPaciente').value;
        const estado = document.getElementById('filtroPacienteEstado').value;
        const qs     = new URLSearchParams();
        if (q)              qs.set('q', q);
        if (estado)         qs.set('estado', estado);
        if (chipTerapeutaId) qs.set('terapeuta_id', chipTerapeutaId);
        const data = await api(`/pacientes?${qs}`);
        pacientesCache = data;
        document.getElementById('tablaPacientes').innerHTML = data.length
          ? data.map(p => {
            const total    = Number(p.sesiones_total) || 0;
            const confirm  = Number(p.citas_confirmadas) || 0;
            const pendient = Math.max(0, total - confirm);
            return `
            <div class="pac-card">
              <div class="pac-card-top">
                <div class="pac-avatar">${(p.nombre?.[0] || '').toUpperCase()}</div>
                <div style="display:flex;gap:4px">
                  <button class="btn-icon" data-ver-paciente="${p.id}" title="Ver detalle"><i class="fas fa-eye"></i></button>
                  <button class="btn-icon" data-edit-paciente="${p.id}" title="Editar"><i class="fas fa-pen"></i></button>
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
                <span style="background:${pendient > 0 ? 'var(--warning-light,#fff8e1)' : 'var(--success-light,#e8f5e9)'};color:${pendient > 0 ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)'};padding:2px 8px;border-radius:10px">
                  <i class="fas fa-hourglass-half"></i> Pendientes: <strong>${pendient}</strong>
                </span>
              </div>
              <div class="pac-card-footer">
                ${badge(p.estado, ESTADO_PACIENTE)}
                ${p.fuente ? `<span class="pac-fuente">${esc(p.fuente)}</span>` : ''}
              </div>
            </div>`;
          }).join('')
          : '<div class="list-empty" style="grid-column:1/-1">Sin pacientes</div>';

        document.querySelectorAll('[data-edit-paciente]').forEach(btn =>
          btn.addEventListener('click', () => showPacienteForm(data.find(p => p.id == btn.dataset.editPaciente)))
        );
        document.querySelectorAll('[data-ver-paciente]').forEach(btn =>
          btn.addEventListener('click', () => showPacienteDetalle(data.find(p => p.id == btn.dataset.verPaciente)))
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function ensureTerapeutasCache() {
      if (!terapeutasCache.length) terapeutasCache = await api('/terapeutas').catch(() => []);
    }

    function pacienteFormHtml(p = null, sesiones = []) {
      const tsOpts = terapeutasCache.map(t =>
        `<option value="${t.id}" ${p?.terapeuta_id == t.id ? 'selected' : ''}>${esc(fullName(t))}</option>`).join('');
      const sesFilas = sesiones.length
        ? sesiones.map(s => sesionFila(s.id, s.fecha_inicio ? String(s.fecha_inicio).slice(0,10) : '', s.sesiones)).join('')
        : sesionFila('', '', '');
      return `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nombre *</label>
            <input class="form-control" id="f_nombre" value="${esc(p?.nombre || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Apellido *</label>
            <input class="form-control" id="f_apellido" value="${esc(p?.apellido || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="f_email" value="${esc(p?.email || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Teléfono</label>
            <input class="form-control" id="f_telefono" value="${esc(p?.telefono || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fecha de nacimiento</label>
            <input type="date" class="form-control" id="f_nacimiento" value="${p?.fecha_nacimiento ? String(p.fecha_nacimiento).slice(0,10) : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Género</label>
            <select class="form-select" id="f_genero">
              <option value="">— Sin especificar —</option>
              <option value="masculino" ${p?.genero === 'masculino' ? 'selected' : ''}>Masculino</option>
              <option value="femenino"  ${p?.genero === 'femenino'  ? 'selected' : ''}>Femenino</option>
              <option value="otro"      ${p?.genero === 'otro'      ? 'selected' : ''}>Otro</option>
              <option value="prefiero_no_decir" ${p?.genero === 'prefiero_no_decir' ? 'selected' : ''}>Prefiero no decir</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select class="form-select" id="f_estado">
              ${Object.entries(ESTADO_PACIENTE).map(([k, v]) =>
                `<option value="${k}" ${(p?.estado || 'prospecto') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Terapeuta</label>
            <select class="form-select" id="f_terapeuta_id">
              <option value="">— Sin asignar —</option>${tsOpts}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Fuente</label>
          <select class="form-select" id="f_fuente">
            <option value="">— Sin especificar —</option>
            ${['instagram','tiktok','web','whatsapp','referido','otro'].map(f =>
              `<option value="${f}" ${p?.fuente === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Motivo de consulta</label>
          <textarea class="form-control" id="f_motivo" rows="2">${esc(p?.motivo_consulta || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label" style="margin-bottom:6px">Sesiones</label>
          <table style="width:100%;border-collapse:collapse" id="sesionesTable">
            <thead>
              <tr style="font-size:12px;color:var(--text-muted)">
                <th style="padding:4px 6px;text-align:left">Fecha de inicio</th>
                <th style="padding:4px 6px;text-align:left">Sesiones</th>
                <th style="width:32px"></th>
              </tr>
            </thead>
            <tbody id="sesionesBody">${sesFilas}</tbody>
          </table>
          <button type="button" class="btn btn-outline btn-sm" id="btnAddSesion" style="margin-top:6px">
            <i class="fas fa-plus"></i> Agregar fila
          </button>
        </div>`;
    }

    function sesionFila(sid, fecha, cant) {
      return `<tr data-sid="${sid}" style="border-top:1px solid var(--border)">
        <td style="padding:4px 6px">
          <input type="date" class="form-control ses-fecha" value="${esc(fecha)}" style="min-width:130px">
        </td>
        <td style="padding:4px 6px">
          <input type="number" min="0" step="1" class="form-control ses-cant" value="${cant}" placeholder="0" style="max-width:90px">
        </td>
        <td style="padding:4px 6px">
          <button type="button" class="btn-icon danger btn-del-sesion" title="Eliminar"><i class="fas fa-times"></i></button>
        </td>
      </tr>`;
    }

    async function showPacienteForm(p = null) {
      await ensureTerapeutasCache();
      const sesiones = p ? await api(`/pacientes/${p.id}/sesiones`).catch(() => []) : [];
      openModal(p ? 'Editar paciente' : 'Nuevo paciente', pacienteFormHtml(p, sesiones), async () => {
        const body = {
          nombre:          document.getElementById('f_nombre').value,
          apellido:        document.getElementById('f_apellido').value,
          email:           document.getElementById('f_email').value,
          telefono:        document.getElementById('f_telefono').value,
          fecha_nacimiento:document.getElementById('f_nacimiento').value || null,
          genero:          document.getElementById('f_genero').value || null,
          estado:          document.getElementById('f_estado').value,
          terapeuta_id:    document.getElementById('f_terapeuta_id').value || null,
          fuente:          document.getElementById('f_fuente').value || null,
          motivo_consulta: document.getElementById('f_motivo').value,
        };
        if (!body.nombre || !body.apellido) throw new Error('Nombre y apellido requeridos');

        let pid = p?.id;
        if (p) {
          await api(`/pacientes/${p.id}`, { method: 'PUT', body });
        } else {
          const r = await api('/pacientes', { method: 'POST', body });
          pid = r.id;
        }

        // Sincronizar filas de sesiones
        const filas = document.querySelectorAll('#sesionesBody tr[data-sid]');
        for (const fila of filas) {
          const sid    = fila.dataset.sid;
          const fecha  = fila.querySelector('.ses-fecha').value || null;
          const cant   = parseInt(fila.querySelector('.ses-cant').value, 10) || 0;
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

      // Listeners dinámicos del formulario de sesiones
      document.getElementById('btnAddSesion')?.addEventListener('click', () => {
        document.getElementById('sesionesBody').insertAdjacentHTML('beforeend', sesionFila('', '', ''));
        bindDelSesion();
      });
      bindDelSesion();
    }

    function bindDelSesion() {
      document.querySelectorAll('.btn-del-sesion').forEach(btn => {
        btn.onclick = () => {
          const fila = btn.closest('tr');
          if (fila.dataset.sid) {
            fila.dataset.deleted = '1';
            fila.style.opacity = '0.3';
            btn.disabled = true;
          } else {
            fila.remove();
          }
        };
      });
    }

    function showPacienteDetalle(p) {
      if (!p) return;
      openModal(`${fullName(p)}`, `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
          <div><span style="color:var(--text-muted)">Email:</span> ${esc(p.email || '—')}</div>
          <div><span style="color:var(--text-muted)">Teléfono:</span> ${esc(p.telefono || '—')}</div>
          <div><span style="color:var(--text-muted)">Estado:</span> ${badge(p.estado, ESTADO_PACIENTE)}</div>
          <div><span style="color:var(--text-muted)">Terapeuta:</span> ${esc(p.terapeuta_nombre || '—')}</div>
          <div><span style="color:var(--text-muted)">Fuente:</span> ${esc(p.fuente || '—')}</div>
          <div><span style="color:var(--text-muted)">Registro:</span> ${fmtDate(p.created_at)}</div>
        </div>
        ${p.motivo_consulta ? `<div style="margin-top:12px"><strong>Motivo:</strong><p style="margin-top:4px;font-size:13px">${esc(p.motivo_consulta)}</p></div>` : ''}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="btnVerHistorial"><i class="fas fa-file-medical"></i> Ver historial</button>
          <button class="btn btn-outline btn-sm" id="btnVerCitas"><i class="fas fa-calendar"></i> Ver citas</button>
        </div>`, null);

      document.getElementById('btnVerHistorial')?.addEventListener('click', () => {
        closeModal();
        window.CRM.switchView('historial');
        const sel = document.getElementById('historialPacienteSelect');
        if (sel) { sel.value = p.id; sel.dispatchEvent(new Event('change')); }
      });
      document.getElementById('btnVerCitas')?.addEventListener('click', () => {
        closeModal();
        window.CRM.switchView('agenda');
      });

      // ocultar footer
      document.getElementById('modalSave').style.display = 'none';
    }

    let searchTimer;
    document.getElementById('buscarPaciente').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadPacientes, 300);
    });
    document.getElementById('filtroPacienteEstado').addEventListener('change', loadPacientes);
    document.getElementById('btnNuevoPaciente').addEventListener('click', () => showPacienteForm());

    viewLoaders['pacientes'] = async () => {
      if (!isAdmin()) {
        document.getElementById('terapeutaChips').style.display = 'none';
      } else {
        document.getElementById('terapeutaChips').style.display = '';
        await loadTerapeutaChips();
      }
      loadPacientes();
    };

  }); // ready
})();
