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

  const { api, toast } = window.CRM;

  function updateBadges(cfg) {
    const metaOk   = cfg.meta_verify_token && cfg.meta_access_token;
    const tiktokOk = cfg.tiktok_app_secret && cfg.tiktok_verify_token;
    const ms = document.getElementById('meta-status');
    const ts = document.getElementById('tiktok-status');
    if (ms) { ms.textContent = metaOk   ? 'Configurado' : 'Sin configurar'; ms.className = 'badge '+(metaOk  ?'badge-green':'badge-yellow'); }
    if (ts) { ts.textContent = tiktokOk ? 'Configurado' : 'Sin configurar'; ts.className = 'badge '+(tiktokOk?'badge-green':'badge-yellow'); }
  }

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
  document.getElementById('btnSaveMeta')?.addEventListener('click', async () => {
    try {
      const body = {
        meta_verify_token: document.getElementById('meta-verify-token').value,
        meta_access_token: document.getElementById('meta-access-token').value,
        meta_app_secret:   document.getElementById('meta-app-secret').value,
      };
      await api('/config', { method:'POST', body });
      toast('Configuración de Instagram guardada'); updateBadges(body);
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnSaveTiktok')?.addEventListener('click', async () => {
    try {
      const body = {
        tiktok_app_secret:   document.getElementById('tiktok-app-secret').value,
        tiktok_verify_token: document.getElementById('tiktok-verify-token').value,
      };
      await api('/config', { method:'POST', body });
      toast('Configuración de TikTok guardada'); updateBadges(body);
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnSaveWidget')?.addEventListener('click', async () => {
    try {
      const texto = document.getElementById('widget-btn-texto').value.trim();
      if (!texto) { toast('El texto no puede estar vacío', 'danger'); return; }
      await api('/config', { method:'POST', body: { widget_btn_texto: texto } });
      toast('Texto del botón actualizado');
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnSaveOpenwa')?.addEventListener('click', async () => {
    try {
      const url = document.getElementById('openwa-url').value.trim();
      await api('/config', { method:'POST', body: {
        openwa_url:     url,
        openwa_api_key: document.getElementById('openwa-api-key').value.trim(),
        openwa_session: document.getElementById('openwa-session').value.trim(),
      }});
      const el = document.getElementById('openwa-status');
      if (el) { el.textContent = url ? 'Configurado' : 'Sin configurar'; el.className = 'badge '+(url?'badge-green':'badge-yellow'); }
      toast('Configuración WhatsApp guardada');
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnTestOpenwa')?.addEventListener('click', async () => {
    const to = prompt('Número WhatsApp destino (ej: 51999999999):');
    if (!to) return;
    try {
      const r = await api('/whatsapp/test', { method:'POST', body: { to, message:'Prueba de WhatsApp desde VHM CRM ✅' } });
      if (r.skipped) toast('OpenWA no configurado — guarda los datos primero', 'danger');
      else toast('Mensaje enviado correctamente ✅');
    } catch (err) { toast('Error: '+err.message, 'danger'); }
  });

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
      await api('/cron/config', { method:'POST', body });
      updateCronStatus(body); toast('Configuración del cron guardada ✅');
    } catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnEjecutarCron')?.addEventListener('click', async () => {
    if (!confirm('¿Ejecutar el envío de WhatsApp ahora?')) return;
    try { await api('/cron/ejecutar', { method:'POST' }); toast('Ejecutando en background…'); }
    catch (err) { toast(err.message, 'danger'); }
  });

  document.getElementById('btnBroadcast')?.addEventListener('click', async () => {
    const message = document.getElementById('cron-mensaje-broadcast').value.trim();
    if (!message) { toast('Escribe un mensaje antes de enviar', 'danger'); return; }
    const terapeutas  = await api('/terapeutas').catch(() => []);
    const conTelefono = terapeutas.filter(t => t.telefono && t.activo);
    if (!conTelefono.length) { toast('Ningún terapeuta tiene teléfono registrado', 'danger'); return; }
    if (!confirm(`¿Enviar este mensaje a ${conTelefono.length} terapeuta(s)?\n\n${message}`)) return;
    try { const r = await api('/cron/broadcast', { method:'POST', body: { message } }); toast(`Enviando a ${r.enviados} terapeuta(s) ✅`); }
    catch (err) { toast('Error: '+err.message, 'danger'); }
  });

  document.getElementById('btnEnviarManual')?.addEventListener('click', async () => {
    const to      = prompt('Número destino (ej: 51999999999):');
    if (!to) return;
    const message = prompt('Mensaje a enviar:');
    if (!message) return;
    try {
      const r = await api('/whatsapp/test', { method:'POST', body: { to, message } });
      if (r.skipped) toast('OpenWA no configurado', 'danger');
      else toast('Mensaje enviado ✅');
    } catch (err) { toast('Error: '+err.message, 'danger'); }
  });

})();
