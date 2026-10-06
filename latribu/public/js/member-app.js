/* Shell compartido: trial banner, nav inferior, guard de sesión */
(function () {
  const BASE = typeof TribuFunnel !== 'undefined' ? TribuFunnel.base() : (window.__APP_BASE__ || '').replace(/\/+$/, '');

  const NAV = [
    { id: 'inicio', href: '/inicio', label: 'Inicio', icon: '🏠' },
    { id: 'biblioteca', href: '/recursos', label: 'Biblioteca', icon: '📚' },
    { id: 'calendario', href: '/calendario', label: 'Calendario', icon: '📅' },
    { id: 'comunidad', href: '/comunidad', label: 'Comunidad', icon: '🫂' },
    { id: 'perfil', href: '/perfil', label: 'Perfil', icon: '👤' },
  ];

  function hoyYmdLima() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  }

  function daysUntil(fechaFinYmd) {
    if (!fechaFinYmd) return null;
    const a = new Date(hoyYmdLima() + 'T12:00:00');
    const b = new Date(String(fechaFinYmd).slice(0, 10) + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  }

  function renewalAfterTrialYmd(fechaFinYmd) {
    const ymd = String(fechaFinYmd || '').slice(0, 10);
    if (!ymd) return '';
    const [y, mo, da] = ymd.split('-').map(Number);
    const d = new Date(Date.UTC(y, mo - 1, da + 1, 12, 0, 0));
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  }

  function activeNavId() {
    const p = location.pathname.replace(/\/+$/, '');
    if (p.endsWith('/inicio') || p.endsWith('/inicio.html')) return 'inicio';
    if (p.endsWith('/recursos') || p.endsWith('/biblioteca')) return 'biblioteca';
    if (p.endsWith('/calendario')) return 'calendario';
    if (p.endsWith('/comunidad')) return 'comunidad';
    if (p.endsWith('/bienestar')) return 'ia';
    if (p.endsWith('/perfil') || p.endsWith('/membresia') || p.endsWith('/suscripciones') || p.endsWith('/tarjetas')) return 'perfil';
    return '';
  }

  function isStartLayout(opts) {
    if (opts && (opts.layout === 'start' || opts.layout === 'funnel')) return true;
    const p = location.pathname.replace(/\/+$/, '');
    return /\/(inicio|comunidad|perfil|membresia|suscripciones|recursos|calendario|bienestar|tarjetas|mi-prueba|recordatorio)(\.html)?$/.test(p);
  }

  function renderBottomNav(skip) {
    if (skip || document.getElementById('memberBottomNav')) return;
    const nav = document.createElement('nav');
    nav.id = 'memberBottomNav';
    nav.className = 'member-bottom-nav';
    nav.setAttribute('aria-label', 'Navegación principal');
    const active = activeNavId();
    nav.innerHTML = NAV.map(n =>
      `<a href="${BASE}${n.href}" class="${active === n.id ? 'active' : ''}"><span class="ico">${n.icon}</span>${n.label}</a>`
    ).join('');
    document.body.appendChild(nav);
  }

  function renderTopBar(startLayout) {
    if (document.getElementById('memberTopBar')) return;
    const bar = document.createElement('header');
    bar.id = 'memberTopBar';
    bar.className = 'member-top' + (startLayout ? ' member-top--start' : '');
    if (startLayout) {
      const active = activeNavId() || 'inicio';
      const links = [
        { id: 'inicio', href: '/inicio', label: 'Inicio' },
        { id: 'biblioteca', href: '/recursos', label: 'Biblioteca' },
        { id: 'calendario', href: '/calendario', label: 'Calendario' },
        { id: 'comunidad', href: '/comunidad', label: 'Comunidad' },
        { id: 'ia', href: '/bienestar', label: 'IA de bienestar' },
        { id: 'perfil', href: '/perfil', label: 'Mi perfil' },
      ];
      const navHtml = links.map(l =>
        `<a href="${BASE}${l.href}" class="${active === l.id ? 'active' : ''}">${l.label}</a>`
      ).join('');
      bar.innerHTML =
        `<a class="member-top-brand" href="${BASE}/inicio">La Tribu</a>` +
        `<nav class="member-top-nav" aria-label="Área miembro">${navHtml}</nav>` +
        `<div class="member-top-start-end">` +
        `<a class="member-top-trial-badge" id="memberTopTrialBadge" href="${BASE}/mi-prueba" hidden>` +
        `<span class="member-top-trial-label">En prueba</span>` +
        `<span class="member-top-trial-days" id="memberTopTrialDays"></span>` +
        `</a>` +
        `<a class="member-top-membership" href="${BASE}/membresia">Mi membresía</a>` +
        `<button type="button" class="member-top-logout" onclick="doLogout ? doLogout() : (clearToken && clearToken(), window.location.href='${BASE}/')">Cerrar sesión</button>` +
        `</div>`;
    } else {
      bar.innerHTML =
        `<a class="member-top-brand" href="${BASE}/inicio">La Tribu</a>` +
        `<div class="member-top-actions">` +
        `<a class="member-top-link" href="${BASE}/membresia">Membresía</a>` +
        `<a class="member-top-link" href="${BASE}/bienestar">IA</a>` +
        `</div>`;
    }
    document.body.prepend(bar);
  }

  function formatRenewalYmd(ymd) {
    if (!ymd) return '';
    return new Date(String(ymd).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-PE', {
      timeZone: 'America/Lima',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function trialCopy(sub) {
    if (!sub?.fecha_fin) return null;
    const left = daysUntil(sub.fecha_fin);
    if (left == null) return null;
    const precio = sub.precio != null ? TribuFunnel.formatMoneySimple(sub.precio) : 'S/39.90';
    const renewYmd = sub.es_prueba ? renewalAfterTrialYmd(sub.fecha_fin) : String(sub.fecha_fin).slice(0, 10);
    const renewDate = typeof TribuFunnel !== 'undefined' && TribuFunnel.formatFunnelRenewalDate
      ? TribuFunnel.formatFunnelRenewalDate(renewYmd)
      : formatRenewalYmd(renewYmd);
    const dias = left <= 0 ? 0 : left;
    return { left, dias, precio, renewDate, esPrueba: !!sub.es_prueba };
  }

  function renderStartTrialChrome(startLayout, sub, copy) {
    const badge = document.getElementById('memberTopTrialBadge');
    const daysEl = document.getElementById('memberTopTrialDays');
    const show = copy && (copy.esPrueba || copy.left <= 7);
    if (startLayout && badge && daysEl) {
      if (show) {
        daysEl.textContent = `${copy.dias} día${copy.dias === 1 ? '' : 's'}`;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
    const strip = document.getElementById('memberTrialStrip');
    if (startLayout && strip) {
      if (!show) {
        strip.hidden = true;
        return;
      }
      strip.innerHTML =
        `Tu prueba: <strong>${copy.dias} día${copy.dias === 1 ? '' : 's'}</strong> para conocer La Tribu · ` +
        `${copy.precio} al mes desde el <strong>${copy.renewDate}</strong>`;
      strip.hidden = false;
    }
  }

  async function renderTrialBanner(startLayout) {
    const main = document.querySelector('[data-member-main]')
      || document.querySelector('.page-shell')
      || document.querySelector('.account-inner');
    if (!main) return;
    const user = window.tribuUser;
    const sub = user?.suscripcion_activa;
    const copy = sub?.fecha_fin ? trialCopy(sub) : null;
    if (!copy) {
      main.classList.add('no-trial');
      renderStartTrialChrome(startLayout, sub, null);
      return;
    }
    main.classList.add(copy.left <= 7 || copy.esPrueba ? 'with-trial' : 'no-trial');
    renderStartTrialChrome(startLayout, sub, copy);
    if (startLayout) return;

    if (document.getElementById('memberTrialBanner')) return;
    if (copy.left > 7) return;

    const banner = document.createElement('div');
    banner.id = 'memberTrialBanner';
    banner.className = 'member-trial-banner';
    const renewNote = copy.left <= 1
      ? 'Mañana termina tu prueba gratuita.'
      : `Te quedan <strong>${copy.dias} día${copy.dias === 1 ? '' : 's'}</strong> de prueba.`;
    banner.innerHTML =
      `${renewNote} ` +
      `<a href="${BASE}/mi-prueba">Ver los 7 días</a> · ` +
      (copy.left <= 2 ? `<a href="${BASE}/recordatorio">Recordatorio</a> · ` : '') +
      `<a href="${BASE}/membresia">Gestionar membresía</a>`;
    main.parentNode.insertBefore(banner, main);
  }

  async function guardMember(options = {}) {
    if (typeof verificarSesion === 'function') {
      const ok = await verificarSesion();
      if (!ok && typeof getToken === 'function' && !getToken()) {
        location.href = BASE + '/checkout';
        return false;
      }
    }
    if (options.requireSub && typeof tieneSuscripcion === 'function' && !tieneSuscripcion()) {
      location.href = BASE + '/checkout';
      return false;
    }
    if (!options.skipOnboarding && window.tribuUser && !window.tribuUser.onboarding_completado) {
      const p = location.pathname;
      if (!p.includes('/empezar') && !p.includes('/confirmacion') && !p.includes('/crear-contrasena')) {
        location.href = BASE + '/empezar/que-buscas';
        return false;
      }
    }
    return true;
  }

  window.MemberApp = {
    init: async (opts) => {
      const options = opts || { requireSub: true };
      const startLayout = isStartLayout(options);
      if (startLayout) {
        document.body.classList.add('member-start');
        const p = location.pathname.replace(/\/+$/, '');
        if (/\/comunidad(\.html)?$/.test(p)) document.body.classList.add('member-community');
        if (/\/perfil(\.html)?$/.test(p)) document.body.classList.add('member-profile');
        if (/\/(membresia|suscripciones)(\.html)?$/.test(p)) document.body.classList.add('member-membership');
        if (/\/recursos(\.html)?$/.test(p)) document.body.classList.add('member-library');
        if (/\/calendario(\.html)?$/.test(p)) document.body.classList.add('member-calendar');
        if (/\/bienestar(\.html)?$/.test(p)) document.body.classList.add('member-bienestar');
        if (/\/tarjetas(\.html)?$/.test(p)) document.body.classList.add('member-account');
      }
      renderTopBar(startLayout);
      renderBottomNav(startLayout);
      document.body.classList.add('member-body');
      const ok = await guardMember(options);
      if (!ok) return false;
      await renderTrialBanner(startLayout);
      return true;
    },
    daysUntil,
  };
})();
