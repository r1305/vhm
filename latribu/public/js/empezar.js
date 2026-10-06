(function () {
  const API = TribuFunnel.api();
  const BASE = TribuFunnel.base();

  const STEPS = [
    { path: '/empezar/que-buscas', index: 0 },
    { path: '/empezar/como-empezar', index: 1 },
    { path: '/empezar/intereses', index: 2 },
  ];

  const FALLBACK_OBJETIVOS = [
    'Sentirme mejor conmigo',
    'Superar algo que me está pesando',
    'Regular ansiedad y sobrepensamiento',
    'Conocer personas',
    'Recuperar motivación',
    'Trabajar mis relaciones',
    'Encontrar mayor dirección',
    'Crecer personalmente',
    'Probar actividades nuevas',
  ];

  const FALLBACK_INTERESES = [
    'Autoestima', 'Ansiedad', 'Relaciones', 'Rupturas', 'Límites', 'Sobrepensamiento',
    'Propósito', 'Bienestar', 'Socialización', 'Hábitos', 'Regulación emocional',
  ];

  let copyCfg = null;
  let FUNNEL_OBJETIVOS = [...FALLBACK_OBJETIVOS];
  let FUNNEL_INTERESES = [...FALLBACK_INTERESES];
  let COMO_OPTIONS = [
    { id: 'recursos', label: 'Viendo recursos por mi cuenta' },
    { id: 'calendario', label: 'Participando en sesiones' },
    { id: 'comunidad', label: 'Conociendo personas' },
    { id: 'incierto', label: 'No estoy seguro todavía' },
  ];
  let STEP_LABELS = ['1 de 3 · ¿Qué buscas?', '2 de 3 · Cómo empezar', '3 de 3 · Tus intereses'];
  let MAX_INTERESES = 3;
  let MAX_OBJETIVOS = 3;

  const sel = { objetivos: [], intereses: [], como: 'recursos' };

  const RECO = {
    recursos: '/recursos',
    calendario: '/calendario',
    comunidad: '/comunidad',
    ia: '/bienestar',
    incierto: '/recursos',
  };

  function stepFromPath() {
    const p = location.pathname.replace(/\/+$/, '');
    const hit = STEPS.find(s => p.endsWith(s.path) || p.endsWith(s.path.replace(/^\//, '')));
    return hit ? hit.index : 0;
  }

  function pathForStep(n) {
    const s = STEPS.find(x => x.index === n);
    return BASE + (s ? s.path : STEPS[0].path);
  }

  function normalizeComo(raw) {
    const v = String(raw || '').trim();
    if (COMO_OPTIONS.some(o => o.id === v)) return v;
    if (v === 'ia') return 'ia';
    return 'recursos';
  }

  function recoHref() {
    const key = normalizeComo(sel.como);
    return BASE + (RECO[key] || RECO.recursos);
  }

  function applyStepCopy(n) {
    const steps = copyCfg?.steps;
    if (!Array.isArray(steps) || !steps[n]) return;
    const s = steps[n];
    const sec = document.getElementById('step' + n);
    if (!sec) return;
    const h1 = sec.querySelector('h1');
    const lead = sec.querySelector('.empezar-lead');
    const micro = sec.querySelector('.empezar-micro');
    if (h1 && s.titulo) h1.textContent = s.titulo;
    if (lead && s.lead) lead.textContent = s.lead;
    if (micro && s.micro) micro.textContent = s.micro;
    sec.querySelectorAll('.empezar-skip').forEach(btn => {
      if (s.skip) btn.textContent = s.skip;
    });
    sec.querySelectorAll('.empezar-cta').forEach(btn => {
      if (s.cta) btn.textContent = s.cta;
    });
  }

  function showStep(n) {
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById('step' + i);
      if (el) el.hidden = i !== n;
      const seg = document.getElementById('prog')?.children[i];
      if (seg) seg.classList.toggle('done', i <= n);
    }
    const lab = document.getElementById('obStepLabel');
    if (lab && STEP_LABELS[n]) lab.textContent = STEP_LABELS[n];
    applyStepCopy(n);
    if (n === 2) updateInteresesCount();
  }

  function renderMultiChips(containerId, options, selected, maxSel) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = options.map(label => {
      const on = selected.includes(label) ? ' on' : '';
      const safe = String(label).replace(/"/g, '&quot;');
      return `<button type="button" class="empezar-chip${on}" data-label="${safe}">${label}</button>`;
    }).join('');
    box.querySelectorAll('.empezar-chip').forEach(btn => {
      btn.onclick = () => {
        const label = btn.getAttribute('data-label');
        const arr = containerId === 'chipsIntereses' ? sel.intereses : sel.objetivos;
        const idx = arr.indexOf(label);
        if (idx >= 0) arr.splice(idx, 1);
        else if (arr.length < maxSel) arr.push(label);
        if (containerId === 'chipsIntereses') updateInteresesCount();
        renderMultiChips(containerId, options, arr, maxSel);
      };
    });
  }

  function renderComoChips() {
    const box = document.getElementById('chipsComo');
    if (!box) return;
    box.innerHTML = COMO_OPTIONS.map(opt => {
      const on = sel.como === opt.id ? ' on' : '';
      return `<button type="button" class="empezar-chip${on}" data-como-id="${opt.id}">${opt.label}</button>`;
    }).join('');
    box.querySelectorAll('.empezar-chip').forEach(btn => {
      btn.onclick = () => {
        sel.como = btn.getAttribute('data-como-id') || 'recursos';
        renderComoChips();
      };
    });
  }

  function updateInteresesCount() {
    const el = document.getElementById('interesesCount');
    const lim = document.getElementById('interesesLimitMsg');
    const n = sel.intereses.length;
    const tpl = copyCfg?.intereses_count || '{n} de {max} intereses seleccionados';
    if (el) el.textContent = TribuFunnel.fillCopy(tpl, { n, max: MAX_INTERESES });
    if (lim) {
      lim.hidden = n < MAX_INTERESES;
      if (copyCfg?.intereses_limit) lim.textContent = copyCfg.intereses_limit;
    }
  }

  async function loadCopyAndCatalog() {
    if (typeof TribuContenido !== 'undefined') {
      copyCfg = await TribuContenido.load('funnel_empezar');
      if (copyCfg) {
        TribuContenido.setText(document.querySelector('.empezar-login'), copyCfg.login_link);
        if (Array.isArray(copyCfg.step_labels)) STEP_LABELS = copyCfg.step_labels;
        if (Array.isArray(copyCfg.como_opciones) && copyCfg.como_opciones.length) {
          COMO_OPTIONS = copyCfg.como_opciones;
        }
        if (Number(copyCfg.max_intereses) > 0) MAX_INTERESES = Number(copyCfg.max_intereses);
        if (Number(copyCfg.max_objetivos) > 0) MAX_OBJETIVOS = Number(copyCfg.max_objetivos);
      }
    }
    try {
      const [oRes, iRes] = await Promise.all([
        fetch(API + '/tribu-catalogo/objetivos'),
        fetch(API + '/tribu-catalogo/intereses'),
      ]);
      if (oRes.ok) {
        const rows = await oRes.json();
        if (Array.isArray(rows) && rows.length) FUNNEL_OBJETIVOS = rows.map(String);
      }
      if (iRes.ok) {
        const rows = await iRes.json();
        if (Array.isArray(rows) && rows.length) FUNNEL_INTERESES = rows.map(String);
      }
    } catch (_) {}
  }

  async function savePartial(extra) {
    const body = Object.assign({
      objetivos: sel.objetivos,
      intereses: sel.intereses,
      como_empezar: sel.como,
      completado: false,
    }, extra || {});
    const res = await tribuFetch('/tribu-auth/onboarding', { method: 'PUT', body });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
    if (d.token) setToken(d.token);
    if (d.user) setStoredUser(d.user);
  }

  async function finishOnboarding() {
    const err = document.getElementById('obErr');
    err.textContent = '';
    await savePartial({ intereses: sel.intereses, completado: true });
    window.location.href = recoHref();
  }

  function hydrateFromUser() {
    const u = window.tribuUser;
    if (!u) return;
    if (Array.isArray(u.objetivos)) {
      sel.objetivos = u.objetivos.filter(l => FUNNEL_OBJETIVOS.includes(l)).slice(0, MAX_OBJETIVOS);
    }
    if (Array.isArray(u.intereses)) {
      sel.intereses = u.intereses.filter(l => FUNNEL_INTERESES.includes(l)).slice(0, MAX_INTERESES);
    }
    if (u.como_empezar) sel.como = normalizeComo(u.como_empezar);
  }

  async function goNextStep(next) {
    const err = document.getElementById('obErr');
    err.textContent = '';
    try {
      if (next === 1) {
        await savePartial({ objetivos: sel.objetivos });
        location.href = pathForStep(1);
        return;
      }
      if (next === 2) {
        await savePartial({ como_empezar: sel.como });
        location.href = pathForStep(2);
        return;
      }
      showStep(next);
    } catch (e) {
      err.textContent = e.message || 'Error al guardar';
    }
  }

  document.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      goNextStep(Number(btn.getAttribute('data-next')));
    });
  });

  document.querySelectorAll('[data-finish]').forEach(btn => {
    btn.addEventListener('click', () => {
      finishOnboarding().catch(e => {
        document.getElementById('obErr').textContent = e.message || 'Error al guardar';
      });
    });
  });

  async function init() {
    if (!getToken()) { location.href = BASE + '/checkout'; return; }
    await loadCopyAndCatalog();
    await verificarSesion();
    if (window.tribuUser?.onboarding_completado) {
      location.href = BASE + '/inicio';
      return;
    }
    hydrateFromUser();
    for (let i = 0; i < 3; i++) applyStepCopy(i);
    renderMultiChips('chipsObjetivos', FUNNEL_OBJETIVOS, sel.objetivos, MAX_OBJETIVOS);
    renderComoChips();
    renderMultiChips('chipsIntereses', FUNNEL_INTERESES, sel.intereses, MAX_INTERESES);
    updateInteresesCount();
    showStep(stepFromPath());
  }

  init();
})();
