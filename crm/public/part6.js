/* ═══════════════════════════════════════════════════════
   VHM CRM — part6.js  Marketing · Asignación automática
   ═══════════════════════════════════════════════════════ */
function togglePwd(id, btn) {
  var inp = document.getElementById(id);
  if (!inp) return;
  var isPwd = inp.type === 'password';
  inp.type = isPwd ? 'text' : 'password';
  btn.querySelector('i').className = isPwd ? 'fas fa-eye-slash' : 'fas fa-eye';
}
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, esc, fmtDate, openModal, viewLoaders, isAdmin } = window.CRM;

    /* ══════════════════════════════════════════════════
       MARKETING
    ══════════════════════════════════════════════════ */
    const ESTADO_CAMP = {
      borrador:   { label: 'Borrador',   css: 'badge-gray'   },
      enviando:   { label: 'Enviando…',  css: 'badge-yellow' },
      completada: { label: 'Completada', css: 'badge-green'  },
      cancelada:  { label: 'Cancelada',  css: 'badge-red'    },
    };

    function mktTab(tab) {
      document.getElementById('mktCampanas').style.display    = tab === 'campanas'    ? '' : 'none';
      document.getElementById('mktSuscriptores').style.display = tab === 'suscriptores' ? '' : 'none';
      document.getElementById('mktBtnCampanas').className    = `btn btn-sm ${tab === 'campanas'    ? 'btn-primary' : 'btn-outline'}`;
      document.getElementById('mktBtnSuscriptores').className = `btn btn-sm ${tab === 'suscriptores' ? 'btn-primary' : 'btn-outline'}`;
      if (tab === 'suscriptores') loadSuscriptores();
      else loadCampanas();
    }

    document.getElementById('mktBtnCampanas')?.addEventListener('click',    () => mktTab('campanas'));
    document.getElementById('mktBtnSuscriptores')?.addEventListener('click', () => mktTab('suscriptores'));

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
              <td>${c.total_enviados || 0}</td>
              <td style="white-space:nowrap">
                ${c.estado === 'borrador' ? `
                  <button class="btn-icon" data-edit-camp="${c.id}" title="Editar"><i class="fas fa-pen"></i></button>
                  <button class="btn btn-sm btn-success" data-enviar-camp="${c.id}" title="Enviar"><i class="fas fa-paper-plane"></i> Enviar</button>
                  <button class="btn-icon danger" data-del-camp="${c.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                ` : ''}
              </td>
            </tr>`).join('')
          : '<tr><td colspan="6" class="list-empty">Sin campañas</td></tr>';

        document.querySelectorAll('[data-edit-camp]').forEach(btn =>
          btn.addEventListener('click', () => showCampanaForm(data.find(c => c.id == btn.dataset.editCamp)))
        );
        document.querySelectorAll('[data-enviar-camp]').forEach(btn =>
          btn.addEventListener('click', async () => {
            if (!confirm('¿Enviar esta campaña a todos los suscriptores? Esta acción no se puede deshacer.')) return;
            try {
              const r = await api(`/marketing/campanas/${btn.dataset.enviarCamp}/enviar`, { method: 'POST' });
              toast(`Enviando a ${r.total} suscriptores`);
              loadCampanas();
            } catch (err) { toast(err.message, 'danger'); }
          })
        );
        document.querySelectorAll('[data-del-camp]').forEach(btn =>
          btn.addEventListener('click', async () => {
            if (!confirm('¿Eliminar campaña?')) return;
            await api(`/marketing/campanas/${btn.dataset.delCamp}`, { method: 'DELETE' });
            toast('Campaña eliminada');
            loadCampanas();
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    function badgeCamp(estado) {
      const e = ESTADO_CAMP[estado] || { label: estado, css: 'badge-gray' };
      return `<span class="badge ${e.css}">${esc(e.label)}</span>`;
    }

    function showCampanaForm(c = null) {
      openModal(c ? 'Editar campaña' : 'Nueva campaña', `
        <div class="form-group">
          <label class="form-label">Nombre *</label>
          <input class="form-control" id="f_nombre" value="${esc(c?.nombre || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Asunto del email *</label>
          <input class="form-control" id="f_asunto" value="${esc(c?.asunto || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Segmento (dejar vacío = todos)</label>
          <input class="form-control" id="f_segmento" value="${esc(c?.segmento || '')}" placeholder="ansiedad, pareja, infantil…">
        </div>
        <div class="form-group">
          <label class="form-label">Contenido HTML *</label>
          <textarea class="form-control" id="f_cuerpo" rows="8" placeholder="<p>Hola {{nombre}},</p><p>Tu mensaje aquí...</p>">${esc(c?.cuerpo_html || '')}</textarea>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Usa <code>{{nombre}}</code> para personalizar con el nombre del suscriptor.
          </div>
        </div>`, async () => {
        const body = {
          nombre:      document.getElementById('f_nombre').value,
          asunto:      document.getElementById('f_asunto').value,
          cuerpo_html: document.getElementById('f_cuerpo').value,
          segmento:    document.getElementById('f_segmento').value || null,
        };
        if (!body.nombre || !body.asunto || !body.cuerpo_html)
          throw new Error('Nombre, asunto y contenido son requeridos');
        if (c) await api(`/marketing/campanas/${c.id}`, { method: 'PUT', body });
        else   await api('/marketing/campanas', { method: 'POST', body });
        toast(c ? 'Campaña actualizada' : 'Campaña creada');
        loadCampanas();
      }, { large: true });
    }

    async function loadSuscriptores() {
      try {
        const data = await api('/marketing/suscriptores');
        document.getElementById('tablaSuscriptores').innerHTML = data.length
          ? data.map(s => `
            <tr>
              <td>${esc(s.email)}</td>
              <td>${esc(s.nombre || '—')}</td>
              <td>${s.segmento ? `<span class="badge badge-blue">${esc(s.segmento)}</span>` : '—'}</td>
              <td>${s.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}</td>
              <td>${fmtDate(s.created_at)}</td>
              <td>
                <button class="btn-icon danger" data-del-sus="${s.id}" title="Desuscribir"><i class="fas fa-times"></i></button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="6" class="list-empty">Sin suscriptores</td></tr>';

        document.querySelectorAll('[data-del-sus]').forEach(btn =>
          btn.addEventListener('click', async () => {
            await api(`/marketing/suscriptores/${btn.dataset.delSus}`, { method: 'DELETE' });
            toast('Suscriptor desactivado');
            loadSuscriptores();
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    document.getElementById('btnNuevaCampana')?.addEventListener('click', () => showCampanaForm());

    viewLoaders['marketing'] = () => { if (isAdmin()) loadCampanas(); };

    /* ══════════════════════════════════════════════════
       ASIGNACIÓN AUTOMÁTICA
    ══════════════════════════════════════════════════ */
    async function loadReglas() {
      if (!isAdmin()) return;
      try {
        const data = await api('/leads/reglas');
        document.getElementById('tablaReglas').innerHTML = data.length
          ? data.map(r => `
            <tr>
              <td><code style="background:var(--primary-light);color:var(--primary);padding:2px 6px;border-radius:4px">${esc(r.keyword)}</code></td>
              <td>${esc(r.terapeuta_nombre)} ${esc(r.terapeuta_apellido)}</td>
              <td>${r.prioridad}</td>
              <td>
                <button class="btn-icon danger" data-del-regla="${r.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')
          : '<tr><td colspan="4" class="list-empty">Sin reglas. Los leads se asignarán al terapeuta con menos carga.</td></tr>';

        document.querySelectorAll('[data-del-regla]').forEach(btn =>
          btn.addEventListener('click', async () => {
            await api(`/leads/reglas/${btn.dataset.delRegla}`, { method: 'DELETE' });
            toast('Regla eliminada');
            loadReglas();
          })
        );
      } catch (err) { toast(err.message, 'danger'); }
    }

    async function showNuevaRegla() {
      const ts = await api('/terapeutas').catch(() => []);
      openModal('Nueva regla de asignación', `
        <div class="form-group">
          <label class="form-label">Palabra clave *</label>
          <input class="form-control" id="f_keyword" placeholder="ej: ansiedad, pareja, infantil, duelo…">
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Si el motivo de consulta contiene esta palabra, el lead se asigna al terapeuta seleccionado.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Terapeuta *</label>
          <select class="form-select" id="f_terapeuta_id">
            <option value="">— Seleccionar —</option>
            ${ts.filter(t => t.rol === 'terapeuta').map(t =>
              `<option value="${t.id}">${esc(t.nombre)} ${esc(t.apellido)} ${t.especialidad ? `— ${esc(t.especialidad)}` : ''}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Prioridad (1 = más alta)</label>
          <input type="number" min="1" max="99" class="form-control" id="f_prioridad" value="1">
        </div>`, async () => {
        const body = {
          keyword:      document.getElementById('f_keyword').value.trim(),
          terapeuta_id: document.getElementById('f_terapeuta_id').value,
          prioridad:    document.getElementById('f_prioridad').value || 1,
        };
        if (!body.keyword || !body.terapeuta_id)
          throw new Error('Keyword y terapeuta son requeridos');
        await api('/leads/reglas', { method: 'POST', body });
        toast('Regla creada');
        loadReglas();
      });
    }

    document.getElementById('btnNuevaRegla')?.addEventListener('click', showNuevaRegla);
    viewLoaders['asignacion'] = loadReglas;

  }); // ready
})();

/* ══════════════════════════════════════════════════
   INTEGRACIONES (Instagram, TikTok, Web widget)
══════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window.CRM) return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const { api, toast, viewLoaders, isAdmin } = window.CRM;

    const BASE = window.__APP_BASE__ || '';

    async function loadIntegraciones() {
      if (!isAdmin()) return;

      // Mostrar URLs de webhooks
      const origin = window.location.origin;
      document.getElementById('meta-webhook-url').textContent   = `${origin}${BASE}/api/leads/webhook/meta`;
      document.getElementById('tiktok-webhook-url').textContent = `${origin}${BASE}/api/leads/webhook/tiktok`;

      // Cargar config guardada
      try {
        const cfg = await api('/config');
        if (cfg.meta_verify_token)   document.getElementById('meta-verify-token').value  = cfg.meta_verify_token;
        if (cfg.meta_access_token)   document.getElementById('meta-access-token').value  = cfg.meta_access_token;
        if (cfg.meta_app_secret)     document.getElementById('meta-app-secret').value    = cfg.meta_app_secret;
        if (cfg.tiktok_app_secret)   document.getElementById('tiktok-app-secret').value  = cfg.tiktok_app_secret;
        if (cfg.tiktok_verify_token) document.getElementById('tiktok-verify-token').value = cfg.tiktok_verify_token;
        const widgetEl = document.getElementById('widget-btn-texto');
        if (widgetEl) widgetEl.value = cfg.widget_btn_texto || '';

        // OpenWA
        if (cfg.openwa_url)     document.getElementById('openwa-url').value     = cfg.openwa_url;
        if (cfg.openwa_api_key) document.getElementById('openwa-api-key').value = cfg.openwa_api_key;
        if (cfg.openwa_session) document.getElementById('openwa-session').value = cfg.openwa_session;
        const owaStatus = document.getElementById('openwa-status');
        if (owaStatus && cfg.openwa_url) { owaStatus.textContent = 'Configurado'; owaStatus.className = 'badge badge-green'; }

        updateBadges(cfg);
      } catch (err) {
        toast('Error cargando config: ' + err.message, 'danger');
      }

      // Cron config
      try {
        const cron = await api('/cron/config');
        document.getElementById('cron-enabled').checked = !!cron.enabled;
        document.getElementById('cron-hora').value   = String(cron.hora).padStart(2,'0');
        document.getElementById('cron-minuto').value = String(cron.minuto).padStart(2,'0');
        const dias = String(cron.dias).split(',').map(d => d.trim());
        document.querySelectorAll('.cron-dia').forEach(cb => {
          cb.checked = dias.includes(cb.value);
        });
        updateCronStatus(cron);
      } catch (_) {}
    }

    // Guardar config Meta
    document.getElementById('btnSaveMeta')?.addEventListener('click', async () => {
      try {
        await api('/config', {
          method: 'POST',
          body: {
            meta_verify_token: document.getElementById('meta-verify-token').value,
            meta_access_token: document.getElementById('meta-access-token').value,
            meta_app_secret:   document.getElementById('meta-app-secret').value,
          },
        });
        toast('Configuracion de Instagram guardada');
        updateBadges({ meta_verify_token: document.getElementById('meta-verify-token').value, meta_access_token: document.getElementById('meta-access-token').value, meta_app_secret: document.getElementById('meta-app-secret').value });
      } catch (err) { toast(err.message, 'danger'); }
    });

    function updateBadges(cfg) {
      if (cfg) {
        var metaOk = cfg.meta_verify_token && cfg.meta_access_token;
        var tiktokOk = cfg.tiktok_app_secret && cfg.tiktok_verify_token;
        var ms = document.getElementById('meta-status');
        var ts = document.getElementById('tiktok-status');
        if (ms) { ms.textContent = metaOk ? 'Configurado' : 'Sin configurar'; ms.className = 'badge ' + (metaOk ? 'badge-green' : 'badge-yellow'); }
        if (ts) { ts.textContent = tiktokOk ? 'Configurado' : 'Sin configurar'; ts.className = 'badge ' + (tiktokOk ? 'badge-green' : 'badge-yellow'); }
      }
    }

    // Guardar config TikTok
    document.getElementById('btnSaveTiktok')?.addEventListener('click', async () => {
      try {
        await api('/config', {
          method: 'POST',
          body: {
            tiktok_app_secret:   document.getElementById('tiktok-app-secret').value,
            tiktok_verify_token: document.getElementById('tiktok-verify-token').value,
          },
        });
        toast('Configuracion de TikTok guardada');
        updateBadges({ tiktok_app_secret: document.getElementById('tiktok-app-secret').value, tiktok_verify_token: document.getElementById('tiktok-verify-token').value });
      } catch (err) { toast(err.message, 'danger'); }
    });

    // Guardar texto del boton widget
    document.getElementById('btnSaveWidget')?.addEventListener('click', async () => {
      try {
        const texto = document.getElementById('widget-btn-texto').value.trim();
        if (!texto) { toast('El texto no puede estar vacío', 'danger'); return; }
        await api('/config', { method: 'POST', body: { widget_btn_texto: texto } });
        toast('Texto del botón actualizado');
      } catch (err) { toast(err.message, 'danger'); }
    });

    // Guardar OpenWA
    document.getElementById('btnSaveOpenwa')?.addEventListener('click', async () => {
      try {
        const url = document.getElementById('openwa-url').value.trim();
        await api('/config', {
          method: 'POST',
          body: {
            openwa_url:     url,
            openwa_api_key: document.getElementById('openwa-api-key').value.trim(),
            openwa_session: document.getElementById('openwa-session').value.trim(),
          },
        });
        const owaStatus = document.getElementById('openwa-status');
        if (owaStatus) { owaStatus.textContent = url ? 'Configurado' : 'Sin configurar'; owaStatus.className = 'badge ' + (url ? 'badge-green' : 'badge-yellow'); }
        toast('Configuración WhatsApp guardada');
      } catch (err) { toast(err.message, 'danger'); }
    });

    // Probar OpenWA
    document.getElementById('btnTestOpenwa')?.addEventListener('click', async () => {
      const to = prompt('Número WhatsApp destino (con código de país, ej: 51999999999):');
      if (!to) return;
      try {
        const r = await api('/whatsapp/test', { method: 'POST', body: { to, message: 'Prueba de WhatsApp desde VHM CRM ✅' } });
        if (r.skipped) toast('OpenWA no configurado — guarda los datos primero', 'danger');
        else toast('Mensaje enviado correctamente ✅');
      } catch (err) { toast('Error: ' + err.message, 'danger'); }
    });

    // Cron helpers
    function updateCronStatus(cron) {
      const el = document.getElementById('cron-status');
      if (!el) return;
      if (cron.enabled) {
        const dias = String(cron.dias).split(',').map(d => ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][+d]).join(', ');
        el.textContent = `Activo — ${String(cron.hora).padStart(2,'0')}:${String(cron.minuto).padStart(2,'0')} (${dias})`;
        el.className = 'badge badge-green';
      } else {
        el.textContent = 'Desactivado';
        el.className = 'badge badge-gray';
      }
    }

    document.getElementById('btnSaveCron')?.addEventListener('click', async () => {
      try {
        const dias = [...document.querySelectorAll('.cron-dia:checked')].map(cb => cb.value).join(',');
        if (!dias) { toast('Selecciona al menos un día', 'danger'); return; }
        const body = {
          enabled: document.getElementById('cron-enabled').checked ? 1 : 0,
          hora:    Number(document.getElementById('cron-hora').value),
          minuto:  Number(document.getElementById('cron-minuto').value),
          dias,
        };
        await api('/cron/config', { method: 'POST', body });
        updateCronStatus(body);
        toast('Configuración del cron guardada ✅');
      } catch (err) { toast(err.message, 'danger'); }
    });

    document.getElementById('btnEjecutarCron')?.addEventListener('click', async () => {
      if (!confirm('¿Ejecutar el envío de WhatsApp ahora? Se enviarán las citas de mañana a todos los terapeutas.')) return;
      try {
        await api('/cron/ejecutar', { method: 'POST' });
        toast('Ejecutando en background… revisa los logs del servidor');
      } catch (err) { toast(err.message, 'danger'); }
    });

    viewLoaders['integraciones'] = loadIntegraciones;
  });
})();
