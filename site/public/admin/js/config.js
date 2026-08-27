(function () {
  AdminLayout.init({ page: 'config', title: '⚙️ Configuración', requireSuperAdmin: true });

  const tabsLoaded = {};
  let susPlanes = [];
  let susEditId = null;
  let guardandoEmail = false;
  let guardandoPixel = false;
  let guardandoWa = false;
  let guardandoRedes = false;
  let guardandoFb = false;
  let guardandoSus = false;
  let guardandoMp = false;
  let enviandoTest = false;
  let mpTokenVisible = false;
  let mpModoPrev = null;

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
    susVisible: document.getElementById('sus-visible'),
    susVisibleLabel: document.getElementById('sus-visible-label'),
    susActivo: document.getElementById('sus-activo'),
    susActivoLabel: document.getElementById('sus-activo-label'),
    susPlanesCount: document.getElementById('sus-planes-count'),
    susPlanesWrap: document.getElementById('sus-planes-wrap'),
    susMsg: document.getElementById('sus-msg'),
    btnNuevoPlan: document.getElementById('btn-nuevo-plan'),
    modalSusTitle: document.getElementById('modal-sus-title'),
    susNombre: document.getElementById('sus-nombre'),
    susPrecio: document.getElementById('sus-precio'),
    susVigencia: document.getElementById('sus-vigencia'),
    susDescripcion: document.getElementById('sus-descripcion'),
    btnGuardarPlan: document.getElementById('btn-guardar-plan'),
    mpActivo: document.getElementById('mp-activo'),
    mpActivoLabel: document.getElementById('mp-activo-label'),
    mpModo: document.getElementById('mp-modo'),
    mpPublicKey: document.getElementById('mp-public-key'),
    mpAccessToken: document.getElementById('mp-access-token'),
    mpFecha: document.getElementById('mp-fecha'),
    mpMsg: document.getElementById('mp-msg'),
    mpCredencialesStatus: document.getElementById('mp-credenciales-status'),
    mpWebhookUrl: document.getElementById('mp-webhook-url'),
    btnGuardarMp: document.getElementById('btn-guardar-mp'),
    btnMpTokenToggle: document.getElementById('btn-mp-token-toggle'),
    testEmailDest: document.getElementById('test-email-dest'),
    testEmailMensaje: document.getElementById('test-email-mensaje'),
    btnEnviarTest: document.getElementById('btn-enviar-test'),
  };

  function fmtFecha(d) {
    if (!d) return '';
    return 'Última actualización: ' + new Date(d).toLocaleString('es-PE');
  }

  function webhookUrl() {
    const base = (window.__APP_BASE__ || '/site').replace(/\/$/, '');
    return window.location.origin + base + '/api/tribu-pagos/webhook';
  }

  function updateSusVisibleLabel(checked) {
    el.susVisibleLabel.textContent = checked ? '🟢 Visible' : '🔴 Oculta';
  }

  function updateSusActivoLabel(checked) {
    el.susActivoLabel.textContent = checked ? '🟢 Habilitado' : '🔴 Deshabilitado';
  }

  function updateMpActivoLabel(checked) {
    el.mpActivoLabel.textContent = checked ? '🟢 Activo' : '🔴 Inactivo';
  }

  function setMpTokenVisible(visible) {
    mpTokenVisible = visible;
    el.mpAccessToken.type = visible ? 'text' : 'password';
    el.btnMpTokenToggle.textContent = visible ? '🙈' : '👁️';
    el.btnMpTokenToggle.title = visible ? 'Ocultar' : 'Mostrar';
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

  /* ── SUSCRIPCIONES ── */
  function renderSusPlanes() {
    el.susPlanesCount.textContent = 'Planes (' + susPlanes.length + ')';
    if (!susPlanes.length) {
      el.susPlanesWrap.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">No hay planes registrados.</p>';
      return;
    }
    let rows = '';
    susPlanes.forEach(function (p) {
      const precio = Number(p.precio).toFixed(2);
      const vigencia = p.vigencia_dias || 30;
      rows +=
        '<tr>' +
          '<td>' + AdminApi.escapeHtml(p.nombre) + '</td>' +
          '<td>S/ ' + precio + '</td>' +
          '<td>' + vigencia + ' días</td>' +
          '<td>' + AdminApi.escapeHtml(p.descripcion || '') + '</td>' +
          '<td>' +
            '<button type="button" class="btn btn-outline btn-xs" data-action="edit-plan" data-id="' + p.id + '" style="margin-right:6px">✏️</button>' +
            '<button type="button" class="btn btn-outline btn-xs" data-action="del-plan" data-id="' + p.id + '" style="color:#e55">🗑️</button>' +
          '</td>' +
        '</tr>';
    });
    el.susPlanesWrap.innerHTML =
      '<table class="sus-planes-table"><thead><tr>' +
        '<th>Nombre</th><th>Precio</th><th>Vigencia</th><th>Descripción</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  async function cargarSuscripciones() {
    try {
      const resCfg = await AdminApi.apiFetch('/suscripciones/config', { headers: AdminApi.authHeaders() });
      const resPlanes = await AdminApi.apiFetch('/suscripciones', { headers: AdminApi.authHeaders() });
      const cfg = await resCfg.json();
      const planes = await resPlanes.json();
      el.susActivo.checked = !!cfg.activo;
      updateSusActivoLabel(el.susActivo.checked);
      el.susVisible.checked = !!cfg.visible;
      updateSusVisibleLabel(el.susVisible.checked);
      susPlanes = Array.isArray(planes) ? planes : [];
      renderSusPlanes();
    } catch {
      AdminUtils.mostrarMsg(el.susMsg, 'Error al cargar suscripciones', false);
    }
  }

  async function guardarConfigSus() {
    try {
      const res = await AdminApi.apiFetch('/suscripciones/config', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify({ activo: el.susActivo.checked, visible: el.susVisible.checked }),
      });
      const d = await res.json();
      AdminUtils.mostrarMsg(el.susMsg, res.ok ? d.message : d.error, res.ok);
    } catch {
      AdminUtils.mostrarMsg(el.susMsg, 'Error de conexión', false);
    }
  }

  function abrirModalSus(plan) {
    if (plan) {
      susEditId = plan.id;
      el.modalSusTitle.textContent = '✏️ Editar plan';
      el.susNombre.value = plan.nombre || '';
      el.susPrecio.value = plan.precio;
      el.susDescripcion.value = plan.descripcion || '';
      el.susVigencia.value = plan.vigencia_dias || 30;
    } else {
      susEditId = null;
      el.modalSusTitle.textContent = '➕ Nuevo plan';
      el.susNombre.value = '';
      el.susPrecio.value = '';
      el.susDescripcion.value = '';
      el.susVigencia.value = '30';
    }
    AdminUtils.mostrarMsg(el.susMsg, '', true);
    AdminUtils.showModal('modal-sus');
  }

  async function guardarPlan() {
    const nombre = el.susNombre.value.trim();
    const precio = el.susPrecio.value;
    if (!nombre || precio === '') {
      AdminUtils.mostrarMsg(el.susMsg, 'Nombre y precio son obligatorios', false);
      return;
    }
    if (guardandoSus) return;
    guardandoSus = true;
    el.btnGuardarPlan.disabled = true;
    el.btnGuardarPlan.textContent = 'Guardando...';
    try {
      const body = {
        nombre: nombre,
        precio: Number(precio),
        descripcion: el.susDescripcion.value.trim(),
        vigencia_dias: Number(el.susVigencia.value) || 30,
      };
      const url = susEditId ? '/suscripciones/' + susEditId : '/suscripciones';
      const method = susEditId ? 'PUT' : 'POST';
      const res = await AdminApi.apiFetch(url, {
        method: method,
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) {
        AdminUtils.hideModal('modal-sus');
        await cargarSuscripciones();
        toast(susEditId ? 'Plan actualizado' : 'Plan creado', 'success');
      } else {
        AdminUtils.mostrarMsg(el.susMsg, d.error || 'Error al guardar', false);
      }
    } catch {
      AdminUtils.mostrarMsg(el.susMsg, 'Error de conexión', false);
    } finally {
      guardandoSus = false;
      el.btnGuardarPlan.disabled = false;
      el.btnGuardarPlan.textContent = '💾 Guardar';
    }
  }

  async function eliminarPlan(id) {
    if (!confirm('¿Eliminar este plan?')) return;
    try {
      const res = await AdminApi.apiFetch('/suscripciones/' + id, {
        method: 'DELETE',
        headers: AdminApi.authHeaders(),
      });
      if (res.ok) {
        await cargarSuscripciones();
        toast('Plan eliminado', 'success');
      } else {
        const d = await res.json();
        toast(d.error || 'Error al eliminar', 'error');
      }
    } catch {
      toast('Error de conexión', 'error');
    }
  }

  function onSusPlanesClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'), 10);
    const action = btn.getAttribute('data-action');
    if (action === 'edit-plan') {
      const plan = susPlanes.find(function (p) { return p.id === id; });
      if (plan) abrirModalSus(plan);
    } else if (action === 'del-plan') {
      eliminarPlan(id);
    }
  }

  function renderMpCredencialesStatus(d) {
    if (!el.mpCredencialesStatus) return;
    const parts = [];
    if (d.credenciales_ok === true) {
      parts.push('✅ Credenciales válidas para modo ' + (d.modo === 'sandbox' ? 'Sandbox (prueba)' : 'Producción'));
      el.mpCredencialesStatus.style.color = '#15803d';
    } else if (d.credenciales_ok === false) {
      parts.push('⚠️ ' + (d.credenciales_error || 'Las credenciales no coinciden con el modo seleccionado'));
      el.mpCredencialesStatus.style.color = '#b91c1c';
    } else {
      el.mpCredencialesStatus.textContent = '';
      return;
    }
    if (d.mp_live_mode === true) {
      parts.push('MP detecta token: PRODUCCIÓN (live_mode=true)');
    } else if (d.mp_live_mode === false) {
      parts.push('MP detecta token: PRUEBA (live_mode=false)');
    }
    if (d.access_token_suffix) {
      parts.push('Token termina en …' + d.access_token_suffix);
    }
    el.mpCredencialesStatus.textContent = parts.join(' · ');
  }

  /* ── MERCADO PAGO ── */
  async function cargarMp() {
    el.mpWebhookUrl.textContent = webhookUrl();
    try {
      const res = await AdminApi.apiFetch('/config-mercadopago', { headers: AdminApi.authHeaders() });
      const d = await res.json();
      el.mpActivo.checked = !!d.activo;
      updateMpActivoLabel(el.mpActivo.checked);
      el.mpModo.value = d.modo || 'sandbox';
      mpModoPrev = el.mpModo.value;
      el.mpPublicKey.value = d.public_key || '';
      el.mpAccessToken.value = d.access_token || '';
      el.mpFecha.textContent = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : '';
      renderMpCredencialesStatus(d);
    } catch {
      AdminUtils.mostrarMsg(el.mpMsg, 'Error al cargar configuración', false);
    }
  }

  async function guardarMp() {
    if (guardandoMp) return;
    if (!el.mpPublicKey.value.trim() || !el.mpAccessToken.value.trim()) {
      AdminUtils.mostrarMsg(
        el.mpMsg,
        'Public Key y Access Token son obligatorios. Al usar Sandbox, copia ambos desde "Credenciales de prueba" en Mercado Pago.',
        false
      );
      return;
    }
    guardandoMp = true;
    el.btnGuardarMp.disabled = true;
    el.btnGuardarMp.textContent = 'Guardando...';
    try {
      const body = {
        activo: el.mpActivo.checked,
        modo: el.mpModo.value,
        public_key: el.mpPublicKey.value,
        access_token: el.mpAccessToken.value,
      };
      const res = await AdminApi.apiFetch('/config-mercadopago', {
        method: 'PUT',
        headers: AdminApi.authHeaders(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      AdminUtils.mostrarMsg(el.mpMsg, res.ok ? d.message : d.error, res.ok);
      if (res.ok) await cargarMp();
    } catch {
      AdminUtils.mostrarMsg(el.mpMsg, 'Error de conexión', false);
    } finally {
      guardandoMp = false;
      el.btnGuardarMp.disabled = false;
      el.btnGuardarMp.textContent = '💾 Guardar configuración';
    }
  }

  /* ── lazy tab loader ── */
  window.onAdminTabChange = function (tab) {
    if (tabsLoaded[tab]) return;
    tabsLoaded[tab] = true;
    if (tab === 'email') cargarEmail();
    else if (tab === 'pixel') cargarPixel();
    else if (tab === 'whatsapp') cargarWhatsapp();
    else if (tab === 'redes') cargarRedes();
    else if (tab === 'facebook') cargarFacebook();
    else if (tab === 'suscripciones') cargarSuscripciones();
    else if (tab === 'mercadopago') cargarMp();
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

    el.susActivo.addEventListener('change', function () {
      updateSusActivoLabel(this.checked);
      guardarConfigSus();
    });
    el.susVisible.addEventListener('change', function () {
      updateSusVisibleLabel(this.checked);
      guardarConfigSus();
    });
    el.btnNuevoPlan.addEventListener('click', function () { abrirModalSus(null); });
    el.btnGuardarPlan.addEventListener('click', guardarPlan);
    el.susPlanesWrap.addEventListener('click', onSusPlanesClick);

    el.mpActivo.addEventListener('change', function () {
      updateMpActivoLabel(this.checked);
    });
    el.mpModo.addEventListener('change', function () {
      if (mpModoPrev !== null && mpModoPrev !== this.value) {
        el.mpPublicKey.value = '';
        el.mpAccessToken.value = '';
        AdminUtils.mostrarMsg(
          el.mpMsg,
          this.value === 'sandbox'
            ? 'Pega Public Key y Access Token de "Credenciales de prueba" (no uses las de producción).'
            : 'Pega Public Key y Access Token de "Credenciales de producción".',
          false
        );
        if (el.mpCredencialesStatus) el.mpCredencialesStatus.textContent = '';
      }
      mpModoPrev = this.value;
    });
    el.btnGuardarMp.addEventListener('click', guardarMp);
    el.btnMpTokenToggle.addEventListener('click', function () {
      setMpTokenVisible(!mpTokenVisible);
    });
  }

  AdminUtils.bindTabs('.sub-tabs');
  AdminUtils.bindModalClose(document.getElementById('page-main'));
  bindEvents();
  window.onAdminTabChange('email');
})();
