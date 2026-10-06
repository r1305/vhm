(function () {
  const BASE = TribuFunnel.base();
  const API = TribuFunnel.api();

  function $(id) { return document.getElementById(id); }

  let copyCfg = null;

  async function loadCopy() {
    if (typeof TribuContenido === 'undefined') return;
    copyCfg = await TribuContenido.load('funnel_confirmacion');
    if (!copyCfg) return;
    TribuContenido.setText(document.querySelector('.cf-login'), copyCfg.login_link);
    TribuContenido.setText(document.querySelector('.cf-tag'), copyCfg.tag);
    TribuContenido.setText($('confTitle'), copyCfg.titulo);
    TribuContenido.setText(document.querySelector('.cf-lead'), copyCfg.lead);
    const steps = document.querySelector('.cf-steps');
    if (steps && Array.isArray(copyCfg.steps)) {
      steps.innerHTML = copyCfg.steps.map((label, i) =>
        `<span><b>${i + 1}</b>${label.replace(/</g, '&lt;')}</span>`
      ).join('');
    }
    const sec = document.querySelector('.cf-secondary');
    if (sec) {
      const inicio = $('confInicioLink');
      const memb = sec.querySelector('a[href="./membresia"]');
      if (inicio && copyCfg.secondary_inicio) inicio.textContent = copyCfg.secondary_inicio;
      if (memb && copyCfg.secondary_membresia) memb.textContent = copyCfg.secondary_membresia;
    }
  }

  function microHtml(fecha, precio) {
    const tpl = copyCfg?.micro_trial || copyCfg?.micro_fallback ||
      'Tu prueba termina el <strong>{fecha}</strong>.<br>Después {precio} al mes, salvo que canceles antes.';
    return TribuFunnel.fillCopy(tpl, { fecha, precio });
  }

  function renewalLabel(trial, renewRaw) {
    const days = trial?.dias;
    return TribuFunnel.formatFunnelRenewalDate(renewRaw, days);
  }

  function setMicroFromTrial(t) {
    const el = $('confMicro');
    if (!el) return;
    const fin = renewalLabel(t, t.fecha_renovacion);
    const precio = t.precio_mensual != null
      ? TribuFunnel.formatMoneySimple(t.precio_mensual)
      : TribuFunnel.formatMoneySimple(39.9);
    if (t.dias && t.fecha_renovacion) {
      el.innerHTML = microHtml(fin, precio);
      return;
    }
    if (t.fecha_renovacion) {
      el.innerHTML = microHtml(fin, precio);
    }
  }

  async function loadMicroFallback() {
    if ($('confMicro')?.querySelector('strong')) return;
    try {
      const res = await fetch(API + '/funnel');
      if (!res.ok) return;
      const cfg = await res.json();
      const renew = cfg.fecha_renovacion_ejemplo;
      const precio = TribuFunnel.formatMoneySimple(cfg.precio_mensual);
      if ($('confMicro')) {
        const fin = TribuFunnel.formatFunnelRenewalDate(renew, cfg.trial_dias);
        $('confMicro').innerHTML = microHtml(fin, precio);
      }
    } catch (_) {}
  }

  function resolveNextCta(user) {
    const btn = $('confNext');
    if (!btn) return;
    if (user?.psw_temp) {
      btn.href = BASE + '/crear-contrasena';
      btn.textContent = copyCfg?.cta_default || 'Empezar';
      return;
    }
    if (user?.onboarding_completado) {
      btn.href = BASE + '/inicio';
      btn.textContent = copyCfg?.cta_inicio || 'Entrar a La Tribu';
      const inicio = $('confInicioLink');
      if (inicio) inicio.style.display = 'none';
      return;
    }
    btn.href = BASE + '/empezar/que-buscas';
    btn.textContent = copyCfg?.cta_default || 'Empezar';
  }

  async function init() {
    if (typeof getToken === 'function' && !getToken()) {
      window.location.href = BASE + '/checkout';
      return;
    }

    await loadCopy();

    try {
      const raw = sessionStorage.getItem('tribu_trial_welcome');
      if (raw) setMicroFromTrial(JSON.parse(raw));
    } catch (_) {}

    await loadMicroFallback();

    if (typeof verificarSesion !== 'function') return;
    await verificarSesion();

    resolveNextCta(window.tribuUser);
  }

  init();
})();
