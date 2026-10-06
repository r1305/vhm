(function () {
  const BASE = TribuFunnel.base();

  let DAY_COPY = [
    'Bienvenida: explora la biblioteca y saluda en comunidad.',
    'Elige un recurso corto y déjate llevar por el tono de La Tribu.',
    'Reserva o anota un encuentro en vivo en el calendario.',
    'Comparte un pequeño logro o reflexión en el mural.',
    'Prueba Clara para ordenar una idea o encontrar un recurso.',
    'Revisa tu membresía: mañana termina la prueba si no cancelas.',
    'Último día de prueba: decide si continúas o cancelas antes del cobro.',
  ];
  let copyCfg = null;

  async function loadCopy() {
    if (typeof TribuContenido === 'undefined') return;
    copyCfg = await TribuContenido.load('member_mi_prueba');
    if (!copyCfg) return;
    if (Array.isArray(copyCfg.timeline) && copyCfg.timeline.length) DAY_COPY = copyCfg.timeline;
    TribuContenido.setText(document.querySelector('.member-hero-kicker'), copyCfg.kicker);
    TribuContenido.setText(document.querySelector('.member-hero h1'), copyCfg.titulo);
    TribuContenido.setText(document.getElementById('trialIntro'), copyCfg.intro_default);
    const h2 = document.querySelector('.member-card h2');
    if (h2 && copyCfg.timeline_titulo) h2.textContent = copyCfg.timeline_titulo;
  }

  function parseYmd(ymd) {
    const s = String(ymd).slice(0, 10);
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function formatDay(d) {
    return d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'short', day: 'numeric', month: 'short' });
  }

  function renderTimeline(sub) {
    const list = document.getElementById('trialTimeline');
    const intro = document.getElementById('trialIntro');
    if (!list || !sub?.fecha_inicio) {
      if (intro) intro.textContent = copyCfg?.sin_prueba || 'No tienes una prueba activa en este momento.';
      return;
    }
    const start = parseYmd(sub.fecha_inicio);
    const fin = parseYmd(sub.fecha_fin);
    const today = new Date();
    const todayYmd = today.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const todayDate = parseYmd(todayYmd);
    let currentDay = Math.floor((todayDate - start) / 86400000) + 1;
    if (currentDay < 1) currentDay = 1;
    if (currentDay > 7) currentDay = 7;

    if (intro && sub.fecha_fin) {
      const left = MemberApp.daysUntil(sub.fecha_fin);
      intro.textContent = left != null && left >= 0
        ? `Te quedan ${left} día${left === 1 ? '' : 's'} de acceso completo (hasta ${sub.fecha_fin}).`
        : intro.textContent;
    }

    list.innerHTML = DAY_COPY.map((copy, i) => {
      const dayNum = i + 1;
      const dayDate = addDays(start, i);
      let cls = '';
      if (dayNum < currentDay) cls = 'done';
      else if (dayNum === currentDay) cls = 'current';
      return `<li class="${cls}"><span class="trial-dot">${dayNum}</span><div><strong>Día ${dayNum}</strong> · ${formatDay(dayDate)}<br><span style="color:var(--muted);font-size:.88rem;">${copy}</span></div></li>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const ok = await MemberApp.init({ requireSub: true });
    if (!ok) return;
    await loadCopy();
    let sub = window.tribuUser?.suscripcion_activa;
    if (!sub?.fecha_inicio) {
      try {
        const res = await tribuFetch('/tribu-auth/suscripciones');
        const d = await res.json();
        const active = (d.data || []).find(s => s.activo && s.es_prueba);
        if (active) {
          sub = {
            fecha_inicio: active.fecha_inicio,
            fecha_fin: active.fecha_fin,
            es_prueba: true,
          };
        }
      } catch (_) {}
    }
    if (sub && !sub.es_prueba) {
      document.getElementById('trialIntro').textContent =
        copyCfg?.no_trial || 'Ya no estás en periodo de prueba. Tu membresía sigue activa según tu plan.';
    }
    renderTimeline(sub);
  });
})();
