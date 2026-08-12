/* ═══════════════════════════════════════════════════════
   VHM CRM — part2.js  Dashboard · Agenda
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, fmtMoney, badge, fullName,
            openModal, viewLoaders, showLoading,
            ESTADO_CITA, FUENTE_ICON,
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

    function buildMesSelect() {
      const sel = document.getElementById('agendaMes');
      if (!sel) return;
      const hoy    = new Date();
      const anio   = hoy.getFullYear();
      const mesMax = hoy.getMonth();
      const MESES  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      sel.innerHTML = '';
      for (let m = 0; m <= mesMax; m++) {
        const val = `${anio}-${String(m + 1).padStart(2,'0')}`;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `${MESES[m]} ${anio}`;
        sel.appendChild(opt);
      }
      sel.value = `${agendaFechaActual.getFullYear()}-${String(agendaFechaActual.getMonth()+1).padStart(2,'0')}`;
    }

    async function loadAgenda() {
      try {
        const dia = document.getElementById('agendaDia')?.value;
        const qs = new URLSearchParams();
        if (dia) {
          qs.set('fecha', dia);
        } else {
          const mes = `${agendaFechaActual.getFullYear()}-${String(agendaFechaActual.getMonth()+1).padStart(2,'0')}`;
          qs.set('mes', mes);
        }
        if (agendaTerapeutaId) qs.set('terapeuta_id', agendaTerapeutaId);
        const agendaPacienteId = document.getElementById('agendaPaciente')?.value;
        if (agendaPacienteId) qs.set('paciente_id', agendaPacienteId);

        const citas = await api(`/citas?${qs}`);
        const tl = document.getElementById('agendaTimeline');
        if (!citas.length) { tl.innerHTML = '<div class="list-empty">Sin citas para este período</div>'; return; }

        // Agrupar por paciente
        const grupos = {};
        const orden  = [];
        citas.forEach(c => {
          const key = String(c.paciente_id);
          if (!grupos[key]) { grupos[key] = { info: c, citas: [] }; orden.push(key); }
          grupos[key].citas.push(c);
        });

        tl.innerHTML = orden.map(key => {
          const { info, citas: cs } = grupos[key];
          const nombre  = `${esc(info.paciente_nombre||'')} ${esc(info.paciente_apellido||'')}`.trim();
          const inicial = (info.paciente_nombre?.[0] || '?').toUpperCase();
          const total   = cs.length;
          const filas   = cs.map(c => `
            <div class="ag-cita-row" data-id="${c.id}">
              <div class="ag-cita-time">${esc(c.fecha ? c.fecha.slice(0,10)+' ' : '')}${esc(c.hora_inicio?.slice(0,5) || '—')}</div>
              <div class="ag-cita-info">
                <span class="ag-cita-tipo">${esc(c.tipo)}</span>
                <span class="ag-cita-meta">${esc(c.terapeuta_nombre)} · ${esc(c.modalidad)}</span>
              </div>
              ${badge(c.estado, ESTADO_CITA)}
              <div class="ag-cita-actions">
                <button class="btn-icon" data-cita-estado="${c.id}" data-actual="${c.estado}" title="Cambiar estado"><i class="fas fa-pen"></i></button>
                <button class="btn-icon" data-send-rec="${c.id}" title="Enviar recordatorio"><i class="fas fa-bell"></i></button>
                ${c.estado !== 'realizada' ? `<button class="btn-icon" style="color:var(--success)" data-confirmar-cita="${c.id}" title="Marcar como realizada"><i class="fas fa-circle-check"></i></button>` : ''}
                ${c.estado !== 'realizada' && c.estado !== 'cancelada' ? `<button class="btn-icon" style="color:var(--danger)" data-cancelar-cita="${c.id}" title="Cancelar sesión"><i class="fas fa-circle-xmark"></i></button>` : ''}
              </div>
            </div>`).join('');
          return `
            <div class="ag-pac-card">
              <details>
                <summary class="ag-pac-summary">
                  <div class="ag-pac-avatar">${inicial}</div>
                  <div class="ag-pac-name">${nombre}</div>
                  <span class="ag-pac-count">${total} cita${total !== 1 ? 's' : ''}</span>
                  <i class="fas fa-chevron-down ag-pac-chevron"></i>
                </summary>
                <div class="ag-citas-list">${filas}</div>
              </details>
            </div>`;
        }).join('');

        tl.querySelectorAll('[data-cita-estado]').forEach(btn =>
          btn.addEventListener('click', () => showCambioEstadoCita(btn.dataset.citaEstado, btn.dataset.actual))
        );
        tl.querySelectorAll('[data-send-rec]').forEach(btn =>
          btn.addEventListener('click', async () => {
            try { await api(`/citas/${btn.dataset.sendRec}/recordatorio`, { method: 'POST' }); toast('Recordatorio enviado'); }
            catch (e) { toast(e.message, 'danger'); }
          })
        );
        tl.querySelectorAll('[data-confirmar-cita]').forEach(btn =>
          btn.addEventListener('click', async () => {
            try {
              await api(`/citas/${btn.dataset.confirmarCita}/estado`, { method: 'PATCH', body: { estado: 'realizada' } });
              toast('Sesión marcada como realizada');
              loadAgenda();
            } catch (e) { toast(e.message, 'danger'); }
          })
        );
        tl.querySelectorAll('[data-cancelar-cita]').forEach(btn =>
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
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function buildPacienteSelect() {
      const sel = document.getElementById('agendaPaciente');
      if (!sel) return;
      const qs = new URLSearchParams();
      if (agendaTerapeutaId) qs.set('terapeuta_id', agendaTerapeutaId);
      const lista = await api(`/pacientes?${qs}`).catch(() => []);
      sel.innerHTML = `<option value="">Todos los pacientes</option>` +
        lista.map(p => `<option value="${p.id}">${esc(fullName(p))}</option>`).join('');
      if (!agendaTerapeutaId) window.CRM.pacientesCache = lista;
    }

    async function loadAgendaTerapeutas() {
      try {
        const ts = await api('/terapeutas');
        const sel = document.getElementById('agendaTerapeuta');
        sel.innerHTML = `<option value="">Todos los terapeutas</option>` +
          ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        if (!isAdmin() && getUser()) {
          sel.value = getUser().id;
          agendaTerapeutaId = String(getUser().id);
          sel.disabled = true;
        } else {
          sel.disabled = false;
        }
        await buildPacienteSelect();
      } catch {}
    }

    document.getElementById('agendaTerapeuta').addEventListener('change', e => {
      agendaTerapeutaId = e.target.value || null;
      document.getElementById('agendaPaciente').value = '';
      buildPacienteSelect();
      loadAgenda();
    });

    document.getElementById('agendaPaciente')?.addEventListener('change', () => loadAgenda());

    document.getElementById('agendaMes')?.addEventListener('change', e => {
      const [anio, mes] = e.target.value.split('-').map(Number);
      const hoy = new Date();
      const esActual = anio === hoy.getFullYear() && mes - 1 === hoy.getMonth();
      agendaFechaActual = esActual ? hoy : new Date(anio, mes - 1, 15);
      const diaInput = document.getElementById('agendaDia');
      if (diaInput) diaInput.value = '';
      loadAgenda();
    });

    document.getElementById('agendaDia')?.addEventListener('change', e => {
      const val = e.target.value;
      if (val) {
        const [y, m, d] = val.split('-').map(Number);
        agendaFechaActual = new Date(y, m - 1, d);
      }
      loadAgenda();
    });

    function localDateISO(d) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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
            <label class="form-label">Hora inicio</label>
            <input type="text" class="form-control" id="f_hora_inicio" placeholder="HH:MM">
          </div>
          <div class="form-group">
            <label class="form-label">Hora fin</label>
            <input type="text" class="form-control" id="f_hora_fin" placeholder="HH:MM">
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
        if (!body.paciente_id || !body.terapeuta_id || !body.fecha)
          throw new Error('Completa todos los campos requeridos');
        await api('/citas', { method: 'POST', body });
        toast('Cita creada');
        loadAgenda();
      });

      const agendaPacienteId = document.getElementById('agendaPaciente')?.value;
      if (agendaPacienteId) {
        const p = (window.CRM.pacientesCache || []).find(p => String(p.id) === agendaPacienteId);
        if (p) {
          document.getElementById('f_paciente_search').value = fullName(p);
          document.getElementById('f_paciente_id').value = p.id;
        }
      }

      api('/terapeutas').then(ts => {
        const sel = document.getElementById('f_terapeuta_id');
        if (!sel) return;
        sel.innerHTML = ts.map(t => `<option value="${t.id}">${esc(fullName(t))}</option>`).join('');
        if (!isAdmin()) sel.value = getUser()?.id;
        if (agendaTerapeutaId) sel.value = agendaTerapeutaId;
        if (agendaPacienteId) {
          const p = (window.CRM.pacientesCache || []).find(p => String(p.id) === agendaPacienteId);
          if (p?.terapeuta_id) sel.value = p.terapeuta_id;
        }
      }).catch(() => {});

      const searchInput = document.getElementById('f_paciente_search');
      const hiddenId    = document.getElementById('f_paciente_id');
      const dropdown    = document.getElementById('f_paciente_dropdown');

      function renderDropdown(q) {
        const q2 = q.toLowerCase();
        const matches = (window.CRM.pacientesCache || []).filter(p =>
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

      document.getElementById('f_hora_inicio')?.addEventListener('change', e => {
        const val = e.target.value;
        if (!val) return;
        const [h, m] = val.split(':').map(Number);
        document.getElementById('f_hora_fin').value =
          `${String((h + 1) % 24).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
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
      buildMesSelect();
      await loadAgendaTerapeutas();
      await loadAgenda();
    };

  }); // ready
})();
