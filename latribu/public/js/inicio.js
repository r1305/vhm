(function () {
  const API = (window.__APP_BASE__ || '').replace(/\/+$/, '') + '/api';
  const BASE = TribuFunnel.base();

  function mesActualLima() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date());
    return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}`;
  }

  function hoyLimaYmd() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  }

  function saludoLima() {
    const hour = Number(new Date().toLocaleString('en-US', {
      timeZone: 'America/Lima',
      hour: 'numeric',
      hour12: false,
    }));
    if (hour < 12) return 'Buenos días';
    if (hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function formatEventWhen(ev) {
    const fecha = String(ev.fecha || '').slice(0, 10);
    const parts = [];
    if (ev.hora_inicio) {
      const h = String(ev.hora_inicio).slice(0, 5);
      const [hh, mm] = h.split(':').map(Number);
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      parts.push(d.toLocaleTimeString('es-PE', {
        timeZone: 'America/Lima',
        hour: 'numeric',
        minute: '2-digit',
      }) + ' · Lima');
    }
    if (fecha) {
      parts.push(new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
        timeZone: 'America/Lima',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }));
    }
    return parts.join(' · ');
  }

  function pickVideo(videos, user) {
    if (!videos.length) return null;
    const intereses = (user?.intereses || []).map(s => String(s).toLowerCase());
    if (intereses.length) {
      const match = videos.find(v => {
        const blob = `${v.titulo} ${v.subtitulo} ${v.categoria_nombre || ''}`.toLowerCase();
        return intereses.some(i => blob.includes(i));
      });
      if (match) return match;
    }
    const withDur = videos.filter(v => v.duracion);
    return withDur[0] || videos[0];
  }

  function duracionLabel(d) {
    const s = String(d || '').trim();
    if (!s) return '';
    if (/min/i.test(s)) return s;
    if (/^\d+$/.test(s)) return s + ' min';
    return s;
  }

  function applyVideoCard(v, ids) {
    const titleEl = document.getElementById(ids.title);
    const descEl = document.getElementById(ids.desc);
    const btn = document.getElementById(ids.btn);
    const kicker = ids.kicker ? document.getElementById(ids.kicker) : null;
    const metaEl = ids.meta ? document.getElementById(ids.meta) : null;
    if (!v) {
      if (titleEl) titleEl.textContent = 'Explora la biblioteca';
      if (btn) { btn.textContent = 'Ir a la biblioteca'; btn.href = BASE + '/recursos'; }
      return;
    }
    if (titleEl) titleEl.textContent = v.titulo || 'Recurso recomendado';
    const cat = (v.categoria_nombre || 'La Tribu').toUpperCase();
    const dur = duracionLabel(v.duracion);
    if (metaEl) {
      const durPart = dur ? dur.replace(/\s*min/i, '').trim() + ' min' : '';
      metaEl.textContent = [durPart, cat].filter(Boolean).join(' · ');
    }
    if (kicker) {
      kicker.textContent = v.categoria_nombre
        ? `La Tribu · ${v.categoria_nombre}`
        : 'La Tribu · Guía práctica';
    }
    const fallbackDesc = 'Un pequeño espacio para salir del piloto automático.';
    if (descEl) {
      if (v.subtitulo) descEl.textContent = v.subtitulo;
      else if (v.descripcion) {
        descEl.textContent = String(v.descripcion).slice(0, 140) + (v.descripcion.length > 140 ? '…' : '');
      } else descEl.textContent = fallbackDesc;
    }
    if (btn) {
      btn.textContent = ids.continueLabel
        ? 'Continuar'
        : (dur ? `Comenzar · ${dur.replace(/\s*min/i, '').trim()} min` : 'Comenzar');
      btn.href = BASE + '/recursos?play=' + encodeURIComponent(v.id);
    }
  }

  async function fetchVideos() {
    const res = await fetch(API + '/videos');
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async function cargarRecursoStart() {
    try {
      const videos = await fetchVideos();
      applyVideoCard(pickVideo(videos, window.tribuUser), {
        title: 'startResourceTitle',
        desc: 'startResourceDesc',
        btn: 'startResourceBtn',
        meta: 'startResourceMeta',
        kicker: null,
      });
      const kicker = document.querySelector('#startResourceCard .res-kicker');
      const v = pickVideo(videos, window.tribuUser);
      if (kicker && v?.categoria_nombre) kicker.textContent = `La Tribu · ${v.categoria_nombre}`;
    } catch (_) {
      const titleEl = document.getElementById('startResourceTitle');
      if (titleEl) titleEl.textContent = 'Biblioteca de recursos';
    }
  }

  async function cargarRecursoHome() {
    try {
      const videos = await fetchVideos();
      const v = pickVideo(videos, window.tribuUser);
      applyVideoCard(v, {
        title: 'homeContinueTitle',
        desc: 'homeContinueDesc',
        btn: 'homeContinueBtn',
        kicker: 'homeContinueKicker',
        continueLabel: true,
      });
    } catch (_) {}
  }

  function guideRecCardHtml(v) {
    const cat = escapeHtml((v.categoria_nombre || 'La Tribu').toUpperCase());
    const dur = escapeHtml(duracionLabel(v.duracion) || '');
    const meta = [dur, cat].filter(Boolean).join(' · ');
    const sub = escapeHtml(v.subtitulo || String(v.descripcion || '').slice(0, 100));
    return `<button type="button" class="lib-guide-card" onclick="location.href='${BASE}/recursos?play=${v.id}'">
      <div class="lib-guide-cover">
        <span class="lib-guide-cover-kicker">La Tribu · Guía práctica</span>
        <span class="lib-guide-cover-title">${escapeHtml(v.titulo || 'Recurso')}</span>
      </div>
      <div class="lib-guide-body">
        ${meta ? `<div class="lib-guide-meta">${meta}</div>` : ''}
        <h3>${escapeHtml(v.titulo || '')}</h3>
        <p>${sub}</p>
      </div>
    </button>`;
  }

  async function cargarRecomendadosHome() {
    const grid = document.getElementById('homeRecGrid');
    if (!grid) return;
    try {
      const videos = await fetchVideos();
      const picked = [];
      const primary = pickVideo(videos, window.tribuUser);
      if (primary) picked.push(primary);
      videos.forEach(v => {
        if (picked.length >= 3) return;
        if (primary && v.id === primary.id) return;
        picked.push(v);
      });
      if (!picked.length) {
        grid.innerHTML = '<p class="member-start-resource-desc">Explora la biblioteca cuando quieras.</p>';
        return;
      }
      grid.innerHTML = picked.slice(0, 3).map(guideRecCardHtml).join('');
    } catch (_) {
      grid.innerHTML = '';
    }
  }

  async function cargarEvento(prefix) {
    const detailEl = document.getElementById(prefix + 'EventDetail');
    const titleEl = document.getElementById(prefix + 'EventTitle');
    const btn = document.getElementById(prefix + 'EventBtn');
    const noteEl = prefix === 'start' ? document.getElementById('startEventNote') : null;
    try {
      const res = await fetch(API + '/eventos?mes=' + mesActualLima());
      if (!res.ok) return;
      let evs = await res.json();
      if (!Array.isArray(evs)) evs = [];
      const hoyStr = hoyLimaYmd();
      evs = evs.filter(e => String(e.fecha).slice(0, 10) >= hoyStr);
      evs.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      const next = evs[0];
      if (!next) return;
      const when = formatEventWhen(next);
      if (detailEl) detailEl.textContent = when || 'Consulta fechas en el calendario.';
      const name = (next.nombre || next.titulo || '').trim();
      if (titleEl && name) titleEl.textContent = name;
      if (noteEl) {
        noteEl.textContent = name || 'Próximo encuentro en vivo';
        noteEl.hidden = false;
      }
      if (btn) {
        btn.textContent = 'Reservar mi lugar';
        btn.href = BASE + '/calendario';
      }
    } catch (_) {}
  }

  function elegirLayout() {
    const home = document.getElementById('memberHomeView');
    const start = document.getElementById('memberStartView');
    const onboarded = !!window.tribuUser?.onboarding_completado;
    if (home) home.hidden = !onboarded;
    if (start) start.hidden = onboarded;
    return onboarded;
  }

  function personalizarHero(onboarded) {
    const u = window.tribuUser;
    const first = u?.nombre ? u.nombre.trim().split(/\s+/)[0] : '';
    if (onboarded) {
      const h1 = document.getElementById('homeSaludoHome');
      if (h1) h1.textContent = first ? `${saludoLima()}, ${first}.` : `${saludoLima()}.`;
    } else {
      const h1 = document.getElementById('homeSaludo');
      if (first && h1) h1.textContent = first + ', empieza por aquí.';
    }
  }

  async function applyInicioCopy() {
    if (typeof TribuContenido === 'undefined') return;
    const c = await TribuContenido.load('member_inicio');
    if (!c) return;
    TribuContenido.setText(document.querySelector('#memberHomeView .member-start-eyebrow'), c.eyebrow);
    TribuContenido.setText(document.getElementById('homeSubHome'), c.sub_home);
    document.querySelectorAll('.member-home-section-title').forEach((el, i) => {
      if (i === 0 && c.section_continue) el.textContent = c.section_continue;
      if (i === 1 && c.section_recommended) el.textContent = c.section_recommended;
    });
    TribuContenido.setText(document.getElementById('startEyebrow'), c.start_eyebrow);
    TribuContenido.setText(document.getElementById('homeSub'), c.start_lead);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const ok = await MemberApp.init({ requireSub: true, layout: 'start' });
    if (!ok) return;
    await applyInicioCopy();
    const onboarded = elegirLayout();
    personalizarHero(onboarded);
    if (onboarded) {
      await Promise.all([
        cargarRecursoHome(),
        cargarEvento('home'),
        cargarRecomendadosHome(),
      ]);
    } else {
      await Promise.all([cargarRecursoStart(), cargarEvento('start')]);
    }
  });
})();
