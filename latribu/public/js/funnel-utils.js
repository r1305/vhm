/* Utilidades compartidas del funnel */
(function () {
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function base() {
    if (typeof window.__APP_BASE__ === 'string') return window.__APP_BASE__.replace(/\/+$/, '');
    const b = document.querySelector('base[href]');
    if (b) {
      try { return new URL(b.getAttribute('href'), location.href).pathname.replace(/\/+$/, ''); } catch (_) {}
    }
    return '';
  }

  window.TribuFunnel = {
    base,
    api: () => base() + '/api',

    captureUtm() {
      const params = new URLSearchParams(location.search);
      const data = {};
      UTM_KEYS.forEach(k => {
        const v = params.get(k);
        if (v) data[k] = v;
      });
      if (Object.keys(data).length) {
        try { sessionStorage.setItem('tribu_utm', JSON.stringify(data)); } catch (_) {}
      }
      return data;
    },

    readUtm() {
      try {
        const raw = sessionStorage.getItem('tribu_utm');
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    },

    goCheckout() {
      window.location.href = base() + '/checkout';
    },

    formatMoney(n) {
      const x = Number(n);
      if (!Number.isFinite(x)) return 'S/ —';
      return 'S/' + x.toFixed(2).replace(/\.00$/, '.90').replace(/\.90$/, x % 1 === 0 ? '.90' : x.toFixed(2).slice(-3));
    },

    formatMoneySimple(n) {
      const x = Number(n);
      if (!Number.isFinite(x)) return 'S/39.90';
      return 'S/' + x.toFixed(2);
    },

    /** Fin de prueba: hoy (Lima) + N días calendario. */
    trialEndDateLima(days) {
      const n = Number(days);
      const add = Number.isFinite(n) && n > 0 ? n : 7;
      const ymd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const [y, mo, da] = ymd.split('-').map(Number);
      const dt = new Date(Date.UTC(y, mo - 1, da + add, 12, 0, 0));
      return dt.toLocaleDateString('es-PE', {
        timeZone: 'America/Lima',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    },

    /** Acepta ISO (YYYY-MM-DD) o texto ya localizado desde /api/funnel o checkout. */
    /** Sustituye {clave} en textos del CMS (checkout, confirmación, etc.). */
    fillCopy(template, vars) {
      let s = String(template == null ? '' : template);
      if (!vars || typeof vars !== 'object') return s;
      Object.keys(vars).forEach(k => {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
      return s;
    },

    formatFunnelRenewalDate(raw, fallbackDays) {
      const s = String(raw || '').trim();
      if (s) {
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          const d = new Date(s.slice(0, 10) + 'T12:00:00');
          if (!Number.isNaN(d.getTime())) {
            return d.toLocaleDateString('es-PE', {
              timeZone: 'America/Lima',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
          }
        }
        const probe = new Date(s.slice(0, 10) + 'T12:00:00');
        if (Number.isNaN(probe.getTime()) && /\bde\b/i.test(s)) return s;
      }
      return this.trialEndDateLima(fallbackDays);
    },
  };

  TribuFunnel.captureUtm();
})();
