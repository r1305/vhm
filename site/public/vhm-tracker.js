/**
 * VHM Tracker — vhm-tracker.js
 * Incluir en vhm.com.pe/site ANTES de clara-chat.js y vhm-crm-widget.js:
 *   <script src="/site/vhm-tracker.js"></script>
 *
 * Captura: pageviews, clicks en CTAs, scroll depth, tiempo de estadía,
 * inicio/envío de formularios, conversiones y fuente de tráfico (UTMs).
 * No usa cookies — identifica visitantes con localStorage (anónimo).
 */
(function () {
  'use strict';

  const CRM      = 'https://vhm.com.pe/crm';
  const TRACK    = `${CRM}/api/track`;
  const SITE_URL = window.location.origin + (window.__APP_BASE__ || '');

  // ── ID de visitante anónimo (persiste en localStorage) ──────
  function getVisitorId() {
    const KEY = '_vhm_vid';
    let vid = localStorage.getItem(KEY);
    if (!vid) {
      vid = 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(KEY, vid);
    }
    return vid;
  }

  // ── ID de sesión (solo dura mientras la pestaña está abierta) ─
  function getSesionId() {
    const KEY = '_vhm_sid';
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  }

  // ── Leer UTMs de la URL ──────────────────────────────────────
  function getUTMs() {
    const p = new URLSearchParams(window.location.search);
    const utms = {
      utm_source:   p.get('utm_source')   || '',
      utm_medium:   p.get('utm_medium')   || '',
      utm_campaign: p.get('utm_campaign') || '',
      utm_content:  p.get('utm_content')  || '',
    };
    // Persistir UTMs en sessionStorage
    const stored = JSON.parse(sessionStorage.getItem('_vhm_utms') || '{}');
    const merged = Object.assign({}, stored);
    for (const k of Object.keys(utms)) {
      if (utms[k]) merged[k] = utms[k];
    }
    if (Object.values(utms).some(v => v)) {
      sessionStorage.setItem('_vhm_utms', JSON.stringify(merged));
    }
    return merged;
  }

  // ── Enviar al CRM (fire-and-forget) ─────────────────────────
  function send(path, body) {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
      navigator.sendBeacon(`${TRACK}${path}`, blob);
    } else {
      fetch(`${TRACK}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    }
  }

  function evento(tipo, elemento, valor) {
    send('/evento', {
      sesion_id:  state.sesion_id,
      visitor_id: state.visitor_id,
      tipo, elemento,
      pagina: window.location.pathname,
      valor:  valor || null,
    });
  }

  // ── Estado de la sesión ──────────────────────────────────────
  const utms = getUTMs();
  const state = {
    visitor_id:  getVisitorId(),
    sesion_id:   getSesionId(),
    inicio:      Date.now(),
    scroll_max:  0,
    pagina:      window.location.href.replace(window.location.origin, ''),
    referrer:    document.referrer || null,
  };

  // ── Iniciar sesión ───────────────────────────────────────────
  function iniciarSesion(extra) {
    send('/sesion', {
      sesion_id:   state.sesion_id,
      visitor_id:  state.visitor_id,
      pagina:      state.pagina,
      referrer:    state.referrer,
      utm_source:  utms.utm_source  || null,
      utm_medium:  utms.utm_medium  || null,
      utm_campaign:utms.utm_campaign || null,
      utm_content: utms.utm_content || null,
      ...extra,
    });
  }

  // ── Actualizar sesión al salir ───────────────────────────────
  function actualizarSesion() {
    const duracion = Math.round((Date.now() - state.inicio) / 1000);
    send('/sesion', {
      sesion_id:   state.sesion_id,
      visitor_id:  state.visitor_id,
      pagina:      state.pagina,
      duracion_seg: duracion,
      scroll_max:  state.scroll_max,
      lead_id:     state.lead_id || null,
    });
  }

  // ── Scroll depth ─────────────────────────────────────────────
  let scrollTimer;
  window.addEventListener('scroll', function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      const scrolled = window.scrollY + window.innerHeight;
      const total    = document.documentElement.scrollHeight || 1;
      const pct      = Math.round((scrolled / total) * 100);
      if (pct > state.scroll_max) {
        state.scroll_max = pct;
        // Hitos: 25%, 50%, 75%, 90%
        for (const hito of [25, 50, 75, 90]) {
          if (pct >= hito && state.scroll_max < hito + 5) {
            evento('scroll', null, `${hito}%`);
          }
        }
      }
    }, 300);
  }, { passive: true });

  // ── Clicks en elementos relevantes ──────────────────────────
  const SELECTORES_CTA = [
    'a[href]', 'button', '[onclick]',
    '.cta', '.btn', '[data-track]',
    'a[href*="wa.me"]', 'a[href*="whatsapp"]',
  ].join(',');

  document.addEventListener('click', function (e) {
    const el = e.target.closest(SELECTORES_CTA);
    if (!el) return;

    const texto = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 100);
    const href  = el.getAttribute('href') || '';
    const label = texto || el.id || el.className.split(' ')[0] || 'elemento';

    // WhatsApp
    if (href.includes('wa.me') || href.includes('whatsapp')) {
      evento('click', 'whatsapp_btn', label);
      return;
    }
    // Links externos
    if (href.startsWith('http') && !href.includes('vhm.com.pe')) {
      evento('click', 'link_externo', href.slice(0, 100));
      return;
    }
    // CTAs y botones
    if (el.tagName === 'BUTTON' || el.classList.contains('cta') || el.classList.contains('btn')) {
      evento('click', label, href || null);
    }
  });

  // ── Formularios ──────────────────────────────────────────────
  document.addEventListener('focusin', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      const form = e.target.closest('form') || e.target.closest('[id*="form"]');
      if (form && !form._vhm_started) {
        form._vhm_started = true;
        evento('form_start', form.id || form.className.split(' ')[0] || 'form', null);
      }
    }
  });

  document.addEventListener('submit', function (e) {
    const form = e.target;
    evento('form_submit', form.id || form.action || 'form', null);
  });

  // ── Integración con el widget del CRM ───────────────────────
  // Cuando alguien llena el formulario de sesión, registrar conversión
  // y vincular la sesión con el lead_id
  const origCapturar = window.VHMWidget?.capturarLead;
  if (origCapturar) {
    window.VHMWidget.capturarLead = async function (data) {
      evento('form_start', 'widget_sesion', null);
      const result = await origCapturar.call(this, data);
      if (result && result.id) {
        state.lead_id = result.id;
        evento('conversion', 'widget_sesion', `lead_id:${result.id}`);
        // Vincular lead con sesión
        send('/sesion', {
          sesion_id:  state.sesion_id,
          visitor_id: state.visitor_id,
          pagina:     state.pagina,
          lead_id:    result.id,
        });
      }
      return result;
    };
  }

  // También interceptar el botón del widget cuando se abre
  document.addEventListener('click', function (e) {
    if (e.target.id === 'vhm-widget-btn' || e.target.closest('#vhm-widget-btn')) {
      evento('click', 'widget_btn_open', null);
    }
  });

  // ── Iniciar y finalizar ──────────────────────────────────────
  iniciarSesion();
  evento('pageview', window.location.pathname, document.title);

  // Al salir de la página
  window.addEventListener('beforeunload', actualizarSesion);
  window.addEventListener('pagehide',     actualizarSesion);

  // Actualización periódica cada 30 seg (para sesiones largas)
  setInterval(actualizarSesion, 30000);

  // Exponer para uso externo
  window.VHMTracker = { evento, state };

})();
