(function () {
  const API = TribuFunnel.api();
  const BASE = TribuFunnel.base();

  const TRIAL_BTN_SEL = '#navTrialBtn,#heroTrialBtn,#videoTrialBtn,#membresiaTrialBtn,#footerTrialBtn,#agendaTrialBtn,#stickyTrialBtn';
  let agendaEmptyText = 'Consulta el calendario completo al entrar a La Tribu.';

  function wireTrialButtons() {
    document.querySelectorAll(TRIAL_BTN_SEL).forEach(btn => {
      btn.addEventListener('click', () => TribuFunnel.goCheckout());
    });
  }

  function applyOffer(cfg) {
    const precio = cfg.precio_mensual ?? 39.9;
    const dias = cfg.trial_dias ?? 7;
    const renew = cfg.fecha_renovacion_ejemplo || '';
    const money = TribuFunnel.formatMoneySimple(precio);
    const line = `S/0 hoy · Luego ${money} al mes · Cancela cuando quieras.`;

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('heroPrice', line);
    set('stickyPriceLine', `S/0 hoy · Luego ${money}/mes`);
    set('footerPriceMicro', `S/0 hoy · Después ${money} al mes · Renovación automática.`);

    const membRenew = document.getElementById('membresiaRenew');
    if (membRenew) membRenew.innerHTML = `Después <strong>${money} al mes.</strong>`;

    const faqPago = document.getElementById('faqPago');
    if (faqPago) {
      faqPago.textContent = `No. Empiezas con ${dias} días gratuitos. Al terminar, la membresía se renueva automáticamente por ${money} mensuales, salvo que canceles antes.`;
    }
    const faqDespues = document.getElementById('faqDespues');
    if (faqDespues) {
      faqDespues.textContent = renew
        ? `Si no cancelas antes, tu tarjeta recibirá un cobro de ${money} el ${renew} y la membresía seguirá renovándose mensualmente. Te avisaremos antes del primer cobro.`
        : `Si no cancelas antes, tu tarjeta recibirá un cobro de ${money} y la membresía seguirá renovándose mensualmente. Te avisaremos antes del primer cobro.`;
    }
  }

  async function loadContenidoSitio() {
    if (typeof TribuContenido === 'undefined') return;
    const hero = await TribuContenido.load('landing_hero');
    if (hero) {
      const sec = document.querySelector('.lp-hero');
      if (sec) {
        TribuContenido.setText(sec.querySelector('.lp-eyebrow'), hero.eyebrow);
        TribuContenido.setHtml(sec.querySelector('h1'), hero.titulo_html);
        TribuContenido.setText(sec.querySelector('.lp-lead'), hero.lead);
        const feat = sec.querySelector('.lp-features');
        if (feat && hero.features) feat.innerHTML = escapeHtml(hero.features).replace(/\n/g, '<br>');
        TribuContenido.setText(document.getElementById('heroTrialBtn'), hero.cta);
        const link = sec.querySelector('.lp-secondary-link');
        if (link && hero.secondary_link) { link.textContent = hero.secondary_link; link.href = '#dentro'; }
        const note = sec.querySelector('.lp-hero-note');
        if (note) {
          const strong = note.querySelector('strong');
          const span = note.querySelector('span');
          if (strong && hero.hero_note_title) strong.innerHTML = escapeHtml(hero.hero_note_title).replace(/\n/g, '<br>');
          TribuContenido.setText(span, hero.hero_note_sub);
        }
      }
      const stripe = document.querySelector('.lp-stripe');
      if (stripe && Array.isArray(hero.stripe)) {
        stripe.innerHTML = hero.stripe.map(t => `<span>${escapeHtml(t)}</span>`).join('');
      }
    }
    const video = await TribuContenido.load('landing_video');
    if (video) {
      const block = document.querySelector('#video .lp-video-block');
      if (block) {
        const tag = block.querySelector('.lp-tag');
        TribuContenido.setText(tag, video.tag);
        const copyCol = block.children[1];
        if (copyCol) {
          TribuContenido.setText(copyCol.querySelector('.lp-eyebrow'), video.eyebrow);
          TribuContenido.setHtml(copyCol.querySelector('h2'), video.titulo);
          TribuContenido.setText(copyCol.querySelector('p'), video.lead);
        }
        TribuContenido.setText(document.getElementById('videoTrialBtn'), video.cta);
        const micro = block.parentElement?.querySelector('.lp-micro');
        TribuContenido.setText(micro, video.micro);
      }
    }
    const momentos = await TribuContenido.load('landing_momentos');
    if (momentos) {
      const sec = document.getElementById('momentos');
      if (sec) {
        const head = sec.querySelector('.lp-section-head');
        if (head) {
          TribuContenido.setHtml(head.querySelector('h2'), momentos.titulo_html);
          TribuContenido.setText(head.querySelector('p'), momentos.subtitulo);
        }
        const grid = sec.querySelector('.lp-benefits');
        if (grid && Array.isArray(momentos.items)) {
          grid.innerHTML = momentos.items.map(it =>
            `<article class="lp-benefit"><span>${escapeHtml(it.num || '')}</span><h3>${escapeHtml(it.titulo || '')}</h3><p>${escapeHtml(it.texto || '')}</p></article>`
          ).join('');
        }
      }
    }
    const agenda = await TribuContenido.load('landing_agenda');
    if (agenda) {
      agendaEmptyText = agenda.empty || agendaEmptyText;
      const sec = document.getElementById('agenda');
      if (sec) {
        const head = sec.querySelector('.lp-section-head');
        if (head) {
          TribuContenido.setHtml(head.querySelector('h2'), agenda.titulo_html);
          TribuContenido.setText(head.querySelector('p'), agenda.subtitulo);
        }
        const micro = sec.querySelector('.lp-micro');
        TribuContenido.setText(micro, agenda.micro);
        TribuContenido.setText(document.getElementById('agendaTrialBtn'), agenda.cta);
      }
    }
    const memb = await TribuContenido.load('landing_membresia');
    if (memb) {
      const sec = document.getElementById('membresia');
      if (sec) {
        TribuContenido.setText(sec.querySelector('.lp-eyebrow'), memb.eyebrow);
        TribuContenido.setHtml(sec.querySelector('h2'), memb.titulo);
        const list = sec.querySelector('.lp-offer-list');
        if (list && Array.isArray(memb.lista)) list.innerHTML = memb.lista.map(li => `<li>${escapeHtml(li)}</li>`).join('');
        const tag = sec.querySelector('.lp-offer-actions .lp-tag');
        TribuContenido.setText(tag, memb.tag);
        TribuContenido.setText(document.getElementById('membresiaTrialBtn'), memb.cta);
        TribuContenido.setText(document.getElementById('membresiaLegal'), memb.legal);
      }
    }
    const faq = await TribuContenido.load('landing_faq');
    if (faq && Array.isArray(faq.items)) {
      const sec = document.getElementById('faq');
      if (sec) {
        TribuContenido.setHtml(sec.querySelector('.lp-section-head h2'), faq.titulo_html);
        sec.querySelectorAll('details').forEach(d => d.remove());
        sec.insertAdjacentHTML('beforeend', faq.items.map((it, i) => {
          const pid = it.clave === 'pago' ? ' id="faqPago"' : it.clave === 'despues' ? ' id="faqDespues"' : '';
          return `<details${i === 0 ? ' open' : ''}><summary>${escapeHtml(it.pregunta)}</summary><p${pid}>${escapeHtml(it.respuesta)}</p></details>`;
        }).join(''));
      }
    }
    const fin = await TribuContenido.load('landing_final');
    if (fin) {
      const sec = document.querySelector('.lp-final-cta');
      if (sec) {
        TribuContenido.setHtml(sec.querySelector('h2'), fin.titulo);
        TribuContenido.setText(sec.querySelector('.lp-lead'), fin.lead);
        TribuContenido.setText(document.getElementById('footerTrialBtn'), fin.cta);
      }
    }
  }

  async function loadLandingBranding() {
    try {
      const res = await fetch(API + '/videos/landing');
      if (!res.ok) return;
      const cfg = await res.json();
      if (cfg.hero_title) {
        const h1 = document.querySelector('.lp-hero h1');
        if (h1) h1.textContent = cfg.hero_title;
      }
      if (cfg.hero_subtitle) {
        const eyebrow = document.querySelector('.lp-hero .lp-eyebrow');
        if (eyebrow) eyebrow.textContent = cfg.hero_subtitle;
      }
      const intro = (cfg.intro || '').trim();
      const pacto = (cfg.pacto || '').trim();
      if (intro || pacto) {
        const videoLead = document.querySelector('#video .lp-video-block p');
        if (videoLead && intro) videoLead.textContent = intro;
      }
    } catch (_) {}
  }

  async function loadBeneficiosLista() {
    try {
      const res = await fetch(API + '/beneficios');
      const items = res.ok ? await res.json() : [];
      if (!Array.isArray(items) || !items.length) return;
      const wrap = document.getElementById('dentro');
      if (!wrap) return;
      let box = document.getElementById('landingBeneficiosApi');
      if (!box) {
        box = document.createElement('ul');
        box.id = 'landingBeneficiosApi';
        box.className = 'lp-beneficios-api';
        box.style.cssText = 'margin:24px 0 0;padding:0;list-style:none;display:grid;gap:8px';
        wrap.querySelector('.lp-section-head')?.after(box);
      }
      box.innerHTML = items.filter(Boolean).map(t => `<li class="lp-micro">✓ ${escapeHtml(t)}</li>`).join('');
    } catch (_) {}
  }

  async function loadVideo() {
    const wrap = document.getElementById('heroVideoWrap');
    const video = document.getElementById('heroVideo');
    const poster = document.getElementById('heroVideoPoster');
    const play = document.getElementById('heroVideoPlay');
    const tag = wrap?.querySelector('.lp-tag');
    if (!wrap || !video) return;

    try {
      const res = await fetch(API + '/videos/landing');
      if (!res.ok) return;
      const cfg = await res.json();
      let src = (cfg.hero_video_url || '').trim();
      if (!src && cfg.hero_video_type === 'drive') src = BASE + '/api/videos/landing/hero-stream';
      if (!src) return;
      if (src.startsWith('/')) src = BASE + src;
      video.src = src;
      if (cfg.hero_poster_url) video.poster = cfg.hero_poster_url;
      video.hidden = false;
      if (poster) poster.hidden = true;
      if (play) {
        play.hidden = false;
        play.addEventListener('click', () => {
          video.hidden = false;
          video.play();
          play.hidden = true;
          if (tag) tag.hidden = true;
        });
      }
      video.addEventListener('play', () => { if (tag) tag.hidden = true; if (play) play.hidden = true; });
    } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function renderQuotePlaceholder(title, body) {
    return `<article class="lp-quote"><span class="lp-tag">Testimonio pendiente</span><h3>${escapeHtml(title)}</h3>` +
      `<div class="lp-placeholder">${escapeHtml(body)}</div>` +
      `<p>Este espacio debe sustituirse por contenido verificado de la comunidad.</p></article>`;
  }

  async function loadTestimonios() {
    const grid = document.getElementById('testimoniosGrid');
    if (!grid) return;
    const placeholders = [
      ['Pertenencia y apoyo', 'Insertar testimonio real.\n\nNombre, foto autorizada y relato breve en sus propias palabras.'],
      ['Herramientas en el día a día', 'Insertar testimonio real.\n\nNombre, foto autorizada y relato breve en sus propias palabras.'],
      ['Volver a participar', 'Insertar testimonio real.\n\nNombre, foto autorizada y relato breve en sus propias palabras.'],
    ];
    try {
      const res = await fetch(API + '/testimonios');
      const data = await res.json();
      const items = (data.data || []).filter(t => t.texto).slice(0, 3);
      if (items.length) {
        grid.innerHTML = items.map(t =>
          `<article class="lp-quote"><span class="lp-tag">Comunidad</span><h3>${escapeHtml(t.autor || 'Miembro')}</h3><p>${escapeHtml(t.texto || '')}</p></article>`
        ).join('');
        while (grid.children.length < 3) {
          const p = placeholders[grid.children.length];
          grid.insertAdjacentHTML('beforeend', renderQuotePlaceholder(p[0], p[1]));
        }
        return;
      }
    } catch (_) {}
    grid.innerHTML = placeholders.map(p => renderQuotePlaceholder(p[0], p[1])).join('');
  }

  function eventCardHtml(e) {
    const fecha = String(e.fecha || '').slice(0, 10);
    const d = fecha ? new Date(fecha + 'T12:00:00') : new Date();
    const dayNum = d.toLocaleDateString('es-PE', { day: '2-digit', timeZone: 'America/Lima' });
    const month = d.toLocaleDateString('es-PE', { month: 'short', timeZone: 'America/Lima' }).toUpperCase();
    const weekday = d.toLocaleDateString('es-PE', { weekday: 'long', timeZone: 'America/Lima' });
    let timeLine = 'Próximamente';
    if (e.hora_inicio) {
      timeLine = String(e.hora_inicio).slice(0, 5) + ' · Lima';
    }
    const cat = escapeHtml(e.categoria || e.tipo || 'Encuentro');
    const title = escapeHtml(e.nombre || 'Actividad La Tribu');
    const desc = escapeHtml(e.descripcion || e.lugar || 'Actividad de La Tribu.');
    return `<article class="lp-event"><div class="lp-event-top"><div class="lp-event-day">${dayNum}<small>${month} · ${escapeHtml(weekday)}</small></div><span class="lp-tag">${cat}</span></div>` +
      `<div class="lp-event-body"><h3>${title}</h3><p>${desc}</p><p class="lp-micro">${timeLine} · 60 min</p>` +
      `<button type="button" class="funnel-btn outline" style="width:100%;margin-top:12px" data-trial-event>Ver encuentros al entrar</button></div></article>`;
  }

  async function loadEventos() {
    const el = document.getElementById('eventosLista');
    if (!el) return;
    const now = new Date();
    const mes = now.toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).slice(0, 7);
    try {
      const res = await fetch(API + '/eventos?mes=' + mes);
      const evs = res.ok ? await res.json() : [];
      const todayLima = now.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
      const upcoming = (Array.isArray(evs) ? evs : [])
        .filter(e => String(e.fecha).slice(0, 10) >= todayLima)
        .slice(0, 3);
      if (!upcoming.length) {
        el.innerHTML = `<p style="color:var(--text-secondary);text-align:center;grid-column:1/-1">${escapeHtml(agendaEmptyText)}</p>`;
        return;
      }
      el.innerHTML = upcoming.map(eventCardHtml).join('');
      el.querySelectorAll('[data-trial-event]').forEach(btn => {
        btn.addEventListener('click', () => TribuFunnel.goCheckout());
      });
    } catch {
      el.innerHTML = '';
    }
  }

  function stickyCta() {
    const bar = document.getElementById('stickyCta');
    const hero = document.getElementById('hero');
    if (!bar || !hero) return;
    const obs = new IntersectionObserver(entries => {
      const show = !entries[0].isIntersecting;
      bar.classList.toggle('show', show);
      bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    }, { threshold: 0.05 });
    obs.observe(hero);
  }

  async function init() {
    TribuFunnel.captureUtm();
    wireTrialButtons();
    stickyCta();
    await loadContenidoSitio();
    await loadLandingBranding();
    try {
      const res = await fetch(API + '/funnel');
      if (res.ok) applyOffer(await res.json());
    } catch (_) {}
    loadVideo();
    loadBeneficiosLista();
    loadTestimonios();
    loadEventos();

    if (typeof verificarSesion === 'function') {
      await verificarSesion();
      if (window.tribuUser && typeof tieneSuscripcion === 'function' && tieneSuscripcion()) {
        window.location.replace(BASE + '/inicio');
      }
    }
  }

  init();
})();
