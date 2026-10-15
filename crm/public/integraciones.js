/* ═══════════════════════════════════════════════════════
   VHM CRM — integraciones.js
   ═══════════════════════════════════════════════════════ */
function togglePwd(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const isPwd = inp.type === 'password';
  inp.type = isPwd ? 'text' : 'password';
  btn.querySelector('i').className = isPwd ? 'fas fa-eye-slash' : 'fas fa-eye';
}

(function () {
  'use strict';

  const { api, toast, confirmDialog, promptDialog } = window.CRM;

  // Toast si viene de callback OAuth
  const qs = new URLSearchParams(location.search);
  if (qs.get('google') === 'ok')    { toast('Google Meet conectado ✅'); history.replaceState(null,'',location.pathname); }
  if (qs.get('google') === 'error') { toast('Error al conectar Google', 'danger'); history.replaceState(null,'',location.pathname); }

  // Google Meet
  document.getElementById('btnGoogleConnect')?.addEventListener('click', async () => {
    const { url } = await api('/integraciones/google/auth-url');
    location.href = url;
  });
  document.getElementById('btnGoogleDisconnect')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Desconectar Google Meet',
      message: '¿Seguro que deseas desconectar la cuenta de Google Meet?',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    await api('/integraciones/google', { method: 'DELETE', successMessage: 'Google desconectado' });
    const badge = document.getElementById('google-status');
    if (badge) { badge.textContent = 'Sin conectar'; badge.className = 'badge badge-yellow'; }
    document.getElementById('btnGoogleDisconnect')?.remove();
    const btn = document.getElementById('btnGoogleConnect');
    if (btn) btn.textContent = 'Conectar cuenta Google';
  });

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

  // Listeners de botones guardar
  document.getElementById('btnSaveOpenwa')?.addEventListener('click', async () => {
    try {
      const url = document.getElementById('openwa-url').value.trim();
      const body = {
        openwa_url:            url,
        openwa_api_key:        document.getElementById('openwa-api-key').value.trim(),
        openwa_session:        document.getElementById('openwa-session').value.trim(),
        openwa_webhook_token:  document.getElementById('openwa-webhook-token').value.trim(),
      };
      ['openwa_api_key', 'openwa_webhook_token'].forEach(k => { if (!body[k]) delete body[k]; });
      await api('/config', { method:'POST', body, successMessage: 'Configuración WhatsApp guardada' });
      ['openwa-api-key', 'openwa-webhook-token'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp && inp.value) { inp.placeholder = 'Guardado. Déjalo vacío para mantenerlo'; inp.value = ''; }
      });
      const el = document.getElementById('openwa-status');
      if (el) { el.textContent = url ? 'Configurado' : 'Sin configurar'; el.className = 'badge '+(url?'badge-green':'badge-yellow'); }
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnSaveMeta')?.addEventListener('click', async () => {
    try {
      const cfgBody = {
        meta_app_id:       document.getElementById('meta-app-id').value.trim(),
        meta_app_secret:   document.getElementById('meta-app-secret').value.trim(),
        meta_verify_token: document.getElementById('meta-verify-token').value.trim(),
      };
      Object.keys(cfgBody).forEach(k => { if (!cfgBody[k]) delete cfgBody[k]; });
      if (Object.keys(cfgBody).length) await api('/config', { method: 'POST', body: cfgBody });
      const igId = document.getElementById('meta-ig-id').value.trim();
      if (igId) {
        await api('/social/cuenta', {
          method: 'PUT',
          body: {
            external_id: igId,
            nombre: document.getElementById('meta-ig-nombre').value.trim(),
            access_token: document.getElementById('meta-page-token').value.trim(),
          },
        });
      }
      ['meta-app-secret', 'meta-verify-token', 'meta-page-token'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp && inp.value) { inp.placeholder = 'Guardado. Déjalo vacío para mantenerlo'; inp.value = ''; }
      });
      toast('Configuración de Instagram guardada', 'success');
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnTestOpenwa')?.addEventListener('click', async () => {
    const to = await promptDialog({
      title: 'Enviar prueba WhatsApp',
      message: 'Ingresa el número de destino con código de país.',
      placeholder: '51999999999',
      confirmLabel: 'Enviar',
    });
    if (!to) return;
    try {
      const r = await api('/whatsapp/test', {
        method:'POST',
        body: { to, message:'Prueba de WhatsApp desde VHM CRM ✅' },
        successMessage: (data) => (data.skipped ? null : 'Mensaje enviado correctamente ✅'),
      });
      if (r.skipped) toast('OpenWA no configurado — guarda los datos primero', 'danger');
    } catch (err) { toast('Error: '+err.message, 'danger'); }
  });

  document.getElementById('btnSaveCron')?.addEventListener('click', async () => {
    try {
      const enabled = document.getElementById('cron-enabled').checked;
      const dias = [...document.querySelectorAll('.cron-dia:checked')].map(cb => cb.value).join(',');
      if (!dias) { toast('Selecciona al menos un día', 'danger'); return; }
      const body = {
        enabled: enabled ? 1 : 0,
        hora:    Number(document.getElementById('cron-hora').value),
        minuto:  Number(document.getElementById('cron-minuto').value),
        dias,
        mensaje: document.getElementById('cron-mensaje-broadcast').value.trim(),
      };
      await api('/cron/config', { method:'POST', body });
      const saved = await api('/cron/config', { loader: false });
      updateCronStatus(saved);
      document.getElementById('cron-enabled').checked = !!saved.enabled;
      document.getElementById('cron-mensaje-broadcast').value = saved.mensaje || '';
      toast(saved.enabled ? 'Cron activado ✅' : 'Cron desactivado');
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnEjecutarCron')?.addEventListener('click', async () => {
    const message = document.getElementById('cron-mensaje-broadcast').value.trim();
    if (!message) { toast('Escribe el mensaje recordatorio antes de ejecutar', 'danger'); return; }
    const terapeutasCron = await api('/cron/terapeutas', { loader: false }).catch(() => []);
    const destinatariosCron = terapeutasCron.filter(t => t.recibe && t.tiene_telefono && t.tiene_pacientes);
    const okCron = await confirmDialog({
      title: 'Ejecutar recordatorio',
      message: `¿Enviar el recordatorio a ${destinatariosCron.length} terapeuta(s) (seleccionados, con teléfono y con pacientes asignados)?`,
      confirmLabel: 'Enviar ahora',
    });
    if (!okCron) return;
    try {
      await api('/cron/config', { method:'POST', body: {
        enabled: document.getElementById('cron-enabled').checked ? 1 : 0,
        hora: Number(document.getElementById('cron-hora').value),
        minuto: Number(document.getElementById('cron-minuto').value),
        dias: [...document.querySelectorAll('.cron-dia:checked')].map(cb => cb.value).join(','),
        mensaje: message,
      }, loader: false });
      const r = await api('/cron/ejecutar', {
        method:'POST',
        successMessage: (data) => {
          if (data.sinConfig || data.sinMensaje || data.errores?.length) return null;
          if (data.enviados === 0 && data.omitidos === 0) return null;
          return `Recordatorio enviado a ${data.enviados} terapeuta(s) ✅`;
        },
      });
      if (r.sinConfig) toast('OpenWA no configurado — guarda URL, API key y Session ID', 'danger');
      else if (r.sinMensaje) toast('Sin mensaje configurado', 'danger');
      else if (r.errores?.length) toast(`Enviados: ${r.enviados}. Errores: ${r.errores.length}`, 'danger');
      else if (r.enviados === 0 && r.omitidos === 0) toast('Ningún terapeuta activo con rol Terapeuta y teléfono', 'danger');
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnBroadcast')?.addEventListener('click', async () => {
    const message = document.getElementById('cron-mensaje-broadcast').value.trim();
    if (!message) { toast('Escribe un mensaje antes de enviar', 'danger'); return; }
    const terapeutas  = await api('/cron/terapeutas').catch(() => []);
    const conTelefono = terapeutas.filter(t => t.recibe && t.tiene_telefono && t.tiene_pacientes);
    if (!conTelefono.length) { toast('Ningún terapeuta seleccionado tiene teléfono y pacientes asignados', 'danger'); return; }
    const okBroadcast = await confirmDialog({
      title: 'Enviar broadcast',
      message: `¿Enviar este mensaje a ${conTelefono.length} terapeuta(s)?\n\n${message}`,
      confirmLabel: 'Enviar',
    });
    if (!okBroadcast) return;
    try {
      await api('/cron/broadcast', {
        method:'POST',
        body: { message },
        successMessage: (r) => `Enviando a ${r.enviados} terapeuta(s) ✅`,
      });
    } catch (err) { toast('Error: '+err.message, 'danger'); }
  });

  const recList = document.getElementById('rec-terapeutas-list');
  const recCount = document.getElementById('rec-terapeutas-count');

  function recChecks() {
    return recList ? [...recList.querySelectorAll('input.rec-terapeuta')] : [];
  }

  function updateRecCount() {
    if (!recCount) return;
    const all = recChecks();
    recCount.textContent = `${all.filter(c => c.checked).length} de ${all.length}`;
  }

  function renderRecTerapeutas(lista) {
    if (!recList) return;
    recList.textContent = '';
    if (!lista.length) {
      const span = document.createElement('span');
      span.style.cssText = 'font-size:13px;color:var(--text-muted)';
      span.textContent = 'No hay terapeutas activos.';
      recList.appendChild(span);
    }
    lista.forEach(t => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'rec-terapeuta';
      cb.value = String(t.id);
      cb.checked = !!t.recibe;
      cb.style.cssText = 'width:16px;height:16px';
      cb.addEventListener('change', updateRecCount);
      const name = document.createElement('span');
      name.textContent = `${t.nombre} ${t.apellido || ''}`.trim() + (t.tiene_telefono ? '' : ' (sin teléfono)');
      label.append(cb, name);
      if (!t.tiene_pacientes) {
        const nota = document.createElement('span');
        nota.style.cssText = 'font-size:12px;color:var(--text-muted)';
        nota.textContent = 'sin pacientes — no recibirá el recordatorio aunque esté marcado';
        label.appendChild(nota);
      }
      recList.appendChild(label);
    });
    updateRecCount();
  }

  async function loadRecTerapeutas() {
    if (!recList) return;
    try {
      renderRecTerapeutas(await api('/cron/terapeutas', { loader: false }));
    } catch (err) {
      recList.textContent = 'No se pudo cargar la lista.';
      toast(err.message, 'danger');
    }
  }

  document.getElementById('btnRecSelAll')?.addEventListener('click', () => {
    recChecks().forEach(c => { c.checked = true; });
    updateRecCount();
  });
  document.getElementById('btnRecSelNone')?.addEventListener('click', () => {
    recChecks().forEach(c => { c.checked = false; });
    updateRecCount();
  });
  document.getElementById('btnSaveRecTerapeutas')?.addEventListener('click', async () => {
    try {
      const ids = recChecks().filter(c => c.checked).map(c => Number(c.value));
      const r = await api('/cron/terapeutas', {
        method: 'PUT',
        body: { terapeuta_ids: ids },
        successMessage: 'Selección de terapeutas guardada',
      });
      renderRecTerapeutas(r.terapeutas || []);
    } catch (err) { toast(err.message, 'danger'); }
  });
  loadRecTerapeutas();

  document.getElementById('btnEnviarManual')?.addEventListener('click', async () => {
    const to = await promptDialog({
      title: 'WhatsApp manual',
      message: 'Número destino con código de país.',
      placeholder: '51999999999',
      confirmLabel: 'Continuar',
    });
    if (!to) return;
    const message = await promptDialog({
      title: 'Mensaje',
      message: 'Escribe el mensaje a enviar.',
      placeholder: 'Tu mensaje…',
      confirmLabel: 'Enviar',
    });
    if (!message) return;
    try {
      const r = await api('/whatsapp/test', {
        method:'POST',
        body: { to, message },
        successMessage: (data) => (data.skipped ? null : 'Mensaje enviado ✅'),
      });
      if (r.skipped) toast('OpenWA no configurado', 'danger');
    } catch (err) { toast('Error: '+err.message, 'danger'); }
  });

})();
