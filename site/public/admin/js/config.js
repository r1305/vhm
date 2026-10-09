(function () {
  AdminLayout.init({ page: 'config', title: '⚙️ Configuración', requireSuperAdmin: true }).then(function (ok) {
  if (!ok) return;

  const tabsLoaded = {};
  let guardandoEmail = false;
  let guardandoPixel = false;
  let guardandoWa = false;
  let guardandoRedes = false;
  let guardandoFb = false;
  let enviandoTest = false;

  const el = {
    emailHost: document.getElementById('email-host'),
    emailPort: document.getElementById('email-port'),
    emailSecure: document.getElementById('email-secure'),
    emailUser: document.getElementById('email-user'),
    emailPass: document.getElementById('email-pass'),
    emailFrom: document.getElementById('email-from'),
    emailNombreFrom: document.getElementById('email-nombre-from'),
    emailFecha: document.getElementById('email-fecha'),
    btnGuardarEmail: document.getElementById('btn-guardar-email'),
    btnTestEmail: document.getElementById('btn-test-email'),
    pixelId: document.getElementById('pixel-id'),
    pixelActivo: document.getElementById('pixel-activo'),
    pixelFecha: document.getElementById('pixel-fecha'),
    pixelMsg: document.getElementById('pixel-msg'),
    btnGuardarPixel: document.getElementById('btn-guardar-pixel'),
    waNumero: document.getElementById('wa-numero'),
    waMensaje: document.getElementById('wa-mensaje'),
    waActivo: document.getElementById('wa-activo'),
    waFecha: document.getElementById('wa-fecha'),
    waMsg: document.getElementById('wa-msg'),
    btnGuardarWa: document.getElementById('btn-guardar-wa'),
    redesInstagram: document.getElementById('redes-instagram'),
    redesFacebook: document.getElementById('redes-facebook'),
    redesYoutube: document.getElementById('redes-youtube'),
    redesTiktok: document.getElementById('redes-tiktok'),
    redesMsg: document.getElementById('redes-msg'),
    btnGuardarRedes: document.getElementById('btn-guardar-redes'),
    fbId: document.getElementById('fb-id'),
    fbFecha: document.getElementById('fb-fecha'),
    fbMsg: document.getElementById('fb-msg'),
    btnGuardarFb: document.getElementById('btn-guardar-fb'),
    testEmailDest: document.getElementById('test-email-dest'),
    testEmailMensaje: document.getElementById('test-email-mensaje'),
    btnEnviarTest: document.getElementById('btn-enviar-test'),
  };

  function fmtFecha(d) {
    if (!d) return '';
    return 'Última actualización: ' + new Date(d).toLocaleString('es-PE');
  }

  /* ── EMAIL ── */
  async function cargarEmail() {
    try {
      const res = await AdminApi.apiFetch('/config-email', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      el.emailHost.value = d.smtp_host || '';
      el.emailPort.value = d.smtp_port || 465;
      el.emailSecure.value = d.smtp_secure !== undefined ? String(Number(d.smtp_secure)) : '1';
      el.emailUser.value = d.smtp_user || '';
      el.emailPass.value = '';
      el.emailFrom.value = d.email_from || '';
      el.emailNombreFrom.value = d.nombre_from || '';
      el.emailFecha.textContent = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : '';
    } catch {
      toast('Error al cargar configuración', 'error');
    }
  }

  async function guardarEmail() {
    if (guardandoEmail) return;
    guardandoEmail = true;
    el.btnGuardarEmail.disabled = true;
    el.btnGuardarEmail.textContent = 'Guardando...';
    try {
      const res = await AdminApi.apiFetch('/config-email', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({
          smtp_host: el.emailHost.value,
          smtp_port: Number(el.emailPort.value) || 465,
          smtp_secure: el.emailSecure.value === '1',
          smtp_user: el.emailUser.value,
          smtp_pass: el.emailPass.value,
          email_from: el.emailFrom.value,
          nombre_from: el.emailNombreFrom.value,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        toast('Configuración guardada', 'success');
        el.emailPass.value = '';
        await cargarEmail();
      } else {
        toast(d.error || 'Error al guardar', 'error');
      }
    } catch {
      toast('Error de conexión', 'error');
    } finally {
      guardandoEmail = false;
      el.btnGuardarEmail.disabled = false;
      el.btnGuardarEmail.textContent = '💾 Guardar configuración';
    }
  }

  async function enviarTestEmail() {
    const email = el.testEmailDest.value.trim();
    const mensaje = el.testEmailMensaje.value.trim();
    if (!email || !mensaje) {
      toast('Completa todos los campos', 'error');
      return;
    }
    if (enviandoTest) return;
    enviandoTest = true;
    el.btnEnviarTest.disabled = true;
    el.btnEnviarTest.textContent = 'Enviando...';
    try {
      const res = await AdminApi.apiFetch('/config-email/test', {
        method: 'POST',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({ email: email, mensaje: mensaje }),
      });
      const d = await res.json();
      if (res.ok) {
        toast('Correo enviado a ' + email, 'success');
        AdminUtils.hideModal('modal-test-email');
        el.testEmailDest.value = '';
        el.testEmailMensaje.value = '';
      } else {
        toast(d.error || 'Error al enviar', 'error');
      }
    } catch {
      toast('Error de conexión', 'error');
    } finally {
      enviandoTest = false;
      el.btnEnviarTest.disabled = false;
      el.btnEnviarTest.textContent = '📨 Enviar';
    }
  }

  /* ── PIXEL ── */
  async function cargarPixel() {
    try {
      const res = await AdminApi.apiFetch('/config-pixel', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      el.pixelId.value = d.pixel_id || '';
      el.pixelActivo.value = d.activo !== undefined ? (d.activo ? '1' : '0') : '0';
      el.pixelFecha.textContent = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : '';
    } catch {
      AdminUtils.mostrarMsg(el.pixelMsg, 'Error al cargar', false);
    }
  }

  async function guardarPixel() {
    if (guardandoPixel) return;
    guardandoPixel = true;
    el.btnGuardarPixel.disabled = true;
    el.btnGuardarPixel.textContent = 'Guardando...';
    try {
      const body = { pixel_id: el.pixelId.value.trim(), activo: el.pixelActivo.value === '1' };
      const res = await AdminApi.apiFetch('/config-pixel', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      AdminUtils.mostrarMsg(el.pixelMsg, res.ok ? d.message : d.error, res.ok);
      if (res.ok) await cargarPixel();
    } catch {
      AdminUtils.mostrarMsg(el.pixelMsg, 'Error de conexión', false);
    } finally {
      guardandoPixel = false;
      el.btnGuardarPixel.disabled = false;
      el.btnGuardarPixel.textContent = '💾 Guardar configuración';
    }
  }

  /* ── WHATSAPP ── */
  async function cargarWhatsapp() {
    try {
      const res = await AdminApi.apiFetch('/config-whatsapp', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      el.waNumero.value = d.numero || '';
      el.waMensaje.value = d.mensaje || '';
      el.waActivo.value = d.activo !== undefined ? (d.activo ? '1' : '0') : '0';
      el.waFecha.textContent = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : '';
    } catch {
      AdminUtils.mostrarMsg(el.waMsg, 'Error al cargar', false);
    }
  }

  async function guardarWhatsapp() {
    if (guardandoWa) return;
    guardandoWa = true;
    el.btnGuardarWa.disabled = true;
    el.btnGuardarWa.textContent = 'Guardando...';
    try {
      const body = {
        numero: el.waNumero.value.trim(),
        mensaje: el.waMensaje.value.trim(),
        activo: el.waActivo.value === '1',
      };
      const res = await AdminApi.apiFetch('/config-whatsapp', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      AdminUtils.mostrarMsg(el.waMsg, res.ok ? d.message : d.error, res.ok);
      if (res.ok) await cargarWhatsapp();
    } catch {
      AdminUtils.mostrarMsg(el.waMsg, 'Error de conexión', false);
    } finally {
      guardandoWa = false;
      el.btnGuardarWa.disabled = false;
      el.btnGuardarWa.textContent = '💾 Guardar configuración';
    }
  }

  /* ── REDES ── */
  async function cargarRedes() {
    try {
      const res = await AdminApi.apiFetch('/config-redes', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      el.redesInstagram.value = d.instagram || '';
      el.redesFacebook.value = d.facebook || '';
      el.redesYoutube.value = d.youtube || '';
      el.redesTiktok.value = d.tiktok || '';
    } catch {
      toast('Error al cargar redes', 'error');
    }
  }

  async function guardarRedes() {
    if (guardandoRedes) return;
    guardandoRedes = true;
    el.btnGuardarRedes.disabled = true;
    el.btnGuardarRedes.textContent = 'Guardando...';
    try {
      const body = {
        instagram: el.redesInstagram.value.trim(),
        facebook: el.redesFacebook.value.trim(),
        youtube: el.redesYoutube.value.trim(),
        tiktok: el.redesTiktok.value.trim(),
      };
      const res = await AdminApi.apiFetch('/config-redes', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) toast(d.message || 'Redes guardadas', 'success');
      else toast(d.error || 'Error', 'error');
    } catch {
      toast('Error de conexión', 'error');
    } finally {
      guardandoRedes = false;
      el.btnGuardarRedes.disabled = false;
      el.btnGuardarRedes.textContent = '💾 Guardar redes';
    }
  }

  /* ── FACEBOOK ── */
  async function cargarFacebook() {
    try {
      const res = await AdminApi.apiFetch('/config-facebook-verification', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      el.fbId.value = d.facebook_domain_verification || '';
      el.fbFecha.textContent = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : '';
    } catch {
      AdminUtils.mostrarMsg(el.fbMsg, 'Error al cargar', false);
    }
  }

  async function guardarFacebook() {
    if (guardandoFb) return;
    guardandoFb = true;
    el.btnGuardarFb.disabled = true;
    el.btnGuardarFb.textContent = 'Guardando...';
    try {
      const body = { facebook_domain_verification: el.fbId.value.trim() };
      const res = await AdminApi.apiFetch('/config-facebook-verification', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      AdminUtils.mostrarMsg(el.fbMsg, res.ok ? d.message : d.error, res.ok);
      if (res.ok) await cargarFacebook();
    } catch {
      AdminUtils.mostrarMsg(el.fbMsg, 'Error de conexión', false);
    } finally {
      guardandoFb = false;
      el.btnGuardarFb.disabled = false;
      el.btnGuardarFb.textContent = '💾 Guardar';
    }
  }

  /* ── PORTADA ── */
  async function cargarPortada() {
    try {
      const res = await AdminApi.apiFetch('/hero-image', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      const preview = document.getElementById('portada-preview');
      if (d.url) {
        preview.innerHTML = `<img src="${d.url}" style="width:100%;max-height:300px;object-fit:cover;display:block">`;
      } else {
        preview.innerHTML = '<span style="color:#555;font-size:.85rem">Sin imagen cargada</span>';
      }
    } catch { toast('Error al cargar portada', 'error'); }
  }

  document.getElementById('btn-subir-portada')?.addEventListener('click', async () => {
    const file = document.getElementById('portada-file').files[0];
    const msg = document.getElementById('portada-msg');
    if (!file) { AdminUtils.mostrarMsg(msg, 'Selecciona una imagen primero', false); return; }
    const btn = document.getElementById('btn-subir-portada');
    btn.disabled = true; btn.textContent = 'Subiendo...';
    try {
      const form = new FormData();
      form.append('imagen', file);
      const res = await fetch((window.__APP_BASE__ || '') + '/api/hero-image', {
        method: 'POST',
        headers: AdminApi.formHeaders(),
        body: form,
        credentials: 'include',
      });
      const d = await res.json();
      if (res.ok) {
        AdminUtils.mostrarMsg(msg, 'Imagen subida correctamente', true);
        tabsLoaded['portada'] = false;
        cargarPortada();
      } else {
        AdminUtils.mostrarMsg(msg, d.error || 'Error al subir', false);
      }
    } catch { AdminUtils.mostrarMsg(msg, 'Error de conexión', false); }
    finally { btn.disabled = false; btn.textContent = '📤 Subir imagen'; }
  });

  document.getElementById('btn-eliminar-portada')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar la imagen de portada?')) return;
    const msg = document.getElementById('portada-msg');
    try {
      const res = await fetch((window.__APP_BASE__ || '') + '/api/hero-image', {
        method: 'DELETE',
        headers: AdminApi.formHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        AdminUtils.mostrarMsg(msg, 'Imagen eliminada', true);
        tabsLoaded['portada'] = false;
        cargarPortada();
      }
    } catch { AdminUtils.mostrarMsg(msg, 'Error al eliminar', false); }
  });

  /* ── lazy tab loader ── */
  window.onAdminTabChange = function (tab) {
    if (tabsLoaded[tab]) return;
    tabsLoaded[tab] = true;
    if (tab === 'email') cargarEmail();
    else if (tab === 'pixel') cargarPixel();
    else if (tab === 'whatsapp') cargarWhatsapp();
    else if (tab === 'redes') cargarRedes();
    else if (tab === 'facebook') cargarFacebook();
    else if (tab === 'portada') cargarPortada();
  };

  function bindEvents() {
    el.btnGuardarEmail.addEventListener('click', guardarEmail);
    el.btnTestEmail.addEventListener('click', function () {
      AdminUtils.showModal('modal-test-email');
    });
    el.btnEnviarTest.addEventListener('click', enviarTestEmail);

    el.btnGuardarPixel.addEventListener('click', guardarPixel);
    el.btnGuardarWa.addEventListener('click', guardarWhatsapp);
    el.btnGuardarRedes.addEventListener('click', guardarRedes);
    el.btnGuardarFb.addEventListener('click', guardarFacebook);
  }

  AdminUtils.bindTabs('.sub-tabs');
  AdminUtils.bindModalClose(document.getElementById('page-main'));
  bindEvents();
  window.onAdminTabChange('email');
  });
})();
