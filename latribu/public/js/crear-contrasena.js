(function () {
  const API = TribuFunnel.api();
  const BASE = TribuFunnel.base();

  function $(id) { return document.getElementById(id); }

  function bindShowPassword() {
    const show = $('pwShow');
    const pw1 = $('pw1');
    const pw2 = $('pw2');
    if (!show || !pw1 || !pw2) return;
    show.addEventListener('change', () => {
      const t = show.checked ? 'text' : 'password';
      pw1.type = t;
      pw2.type = t;
    });
  }

  async function loadCopy() {
    if (typeof TribuContenido === 'undefined') return;
    const c = await TribuContenido.load('funnel_crear_contrasena');
    if (!c) return;
    TribuContenido.setText(document.querySelector('.cuenta-login'), c.login_link);
    TribuContenido.setText(document.querySelector('.cuenta-step-label'), c.step_label);
    TribuContenido.setText(document.querySelector('.cuenta-onboarding h1'), c.titulo);
    TribuContenido.setText(document.querySelector('.cuenta-lead'), c.lead);
    TribuContenido.setText(document.querySelector('.cuenta-foot'), c.foot);
    TribuContenido.setText($('pwSave'), c.submit);
  }

  async function init() {
    if (typeof getToken !== 'function' || !getToken()) {
      window.location.href = BASE + '/checkout';
      return;
    }

    await loadCopy();
    bindShowPassword();

    if (typeof verificarSesion === 'function') {
      await verificarSesion();
    }

    const user = window.tribuUser;
    const emailEl = $('cuentaEmail');
    if (emailEl && user?.email) emailEl.value = user.email;

    if (user && !user.psw_temp) {
      window.location.href = user.onboarding_completado ? BASE + '/inicio' : BASE + '/empezar/que-buscas';
      return;
    }

    $('cuentaForm')?.addEventListener('submit', onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const err = $('pwErr');
    const btn = $('pwSave');
    const a = $('pw1').value;
    const b = $('pw2').value;
    err.textContent = '';

    if (a.length < 8) {
      err.textContent = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }
    if (a !== b) {
      err.textContent = 'Las contraseñas no coinciden.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      const res = await fetch(API + '/tribu-auth/definir-contrasena', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken(),
        },
        body: JSON.stringify({ newPassword: a }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Error al guardar');

      if (d.token) setToken(d.token);
      if (d.user) setStoredUser(d.user);

      window.location.href = BASE + '/empezar/que-buscas';
    } catch (ex) {
      err.textContent = ex.message || 'No se pudo guardar la contraseña.';
      btn.disabled = false;
      btn.textContent = 'Continuar';
    }
  }

  init();
})();
