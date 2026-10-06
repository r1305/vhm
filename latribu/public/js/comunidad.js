(function () {
  const BASE = typeof TribuFunnel !== 'undefined' ? TribuFunnel.base() : (window.__APP_BASE__ || '').replace(/\/+$/, '');

  const TIPOS = [
    { id: 'avance', label: 'Compartir avance', composeLabel: 'Compartir avance', placeholder: 'Una idea, una pregunta o un pequeño avance…' },
    { id: 'pregunta', label: 'Hacer una pregunta', composeLabel: 'Tu pregunta', placeholder: '¿Qué te gustaría preguntar a la tribu?' },
    { id: 'apoyo', label: 'Pedir apoyo', composeLabel: 'Pedir apoyo', placeholder: 'Cuéntanos en qué te gustaría sentir apoyo…' },
    { id: 'compartir', label: 'Compartir algo', composeLabel: 'Compartir algo', placeholder: 'Algo que tengas en mente, en tus propias palabras…' },
    { id: 'logro', label: 'Celebrar un logro', composeLabel: 'Celebrar un logro', placeholder: 'Un avance pequeño que quieras celebrar…' },
  ];

  const TIPO_LABEL = Object.fromEntries(TIPOS.map(t => [t.id, t.label]));

  const FEED_TABS = [
    { id: 'para_ti', label: 'Para ti' },
    { id: 'recientes', label: 'Recientes' },
    { id: 'logros', label: 'Logros' },
    { id: 'preguntas', label: 'Preguntas' },
    { id: 'actividades', label: 'Actividades' },
  ];

  const pageLoader = document.getElementById('pageLoader');
  const postInput = document.getElementById('communityPostInput');
  const postBtn = document.getElementById('communityPostBtn');
  const postMsg = document.getElementById('communityPostMsg');
  const composeLabel = document.getElementById('communityComposeLabel');
  const intentChips = document.getElementById('communityIntentChips');
  const feedTabs = document.getElementById('communityFeedTabs');
  const feedEl = document.getElementById('communityFeed');
  const feedMore = document.getElementById('communityFeedMore');
  let selectedTipo = 'avance';
  let feedTab = 'para_ti';
  const feed = { page: 1, totalPages: 1, orden: 'recientes', cargando: false, cache: [] };

  function encodeContenido(tipo, body) {
    const t = String(body || '').trim();
    return `#tipo:${tipo}\n${t}`;
  }

  function parseContenido(raw) {
    const s = String(raw == null ? '' : raw);
    const m = s.match(/^#tipo:([a-z_]+)\n([\s\S]*)$/);
    if (m) return { tipo: m[1], body: m[2].trim() };
    return { tipo: 'avance', body: s.trim() };
  }

  function tipoMatchesTab(tipo, tab) {
    if (tab === 'para_ti' || tab === 'recientes') return true;
    if (tab === 'logros') return tipo === 'logro' || tipo === 'avance';
    if (tab === 'preguntas') return tipo === 'pregunta';
    if (tab === 'actividades') return tipo === 'apoyo' || tipo === 'compartir';
    return true;
  }

  function showLoader(show) {
    pageLoader?.classList.toggle('show', !!show);
  }

  function showMessage(message, type) {
    if (!postMsg) return;
    postMsg.textContent = message;
    postMsg.className = 'community-post-msg ' + (type || 'info');
    postMsg.hidden = false;
    if (type === 'success' || type === 'info') {
      setTimeout(() => { postMsg.hidden = true; }, 5000);
    }
  }

  function tiempoRelativo(iso) {
    const t = new Date(iso).getTime();
    if (!t || Number.isNaN(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins} min`;
    const hs = Math.round(mins / 60);
    if (hs < 24) return `hace ${hs} h`;
    const ds = Math.round(hs / 24);
    if (ds === 1) return 'ayer';
    if (ds < 30) return `hace ${ds} días`;
    return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short' });
  }

  function avatarAutor(autor) {
    if (autor.foto_url) return `<img src="${escapeHtml(autor.foto_url)}" alt="">`;
    return escapeHtml(autor.iniciales || '?');
  }

  function tarjetaPost(p) {
    const parsed = parseContenido(p.contenido);
    const tipoNombre = TIPO_LABEL[parsed.tipo] || 'Compartir avance';
    const foto = p.foto_url
      ? `<img class="community-post-photo" src="${escapeHtml(p.foto_url)}" alt="" loading="lazy">`
      : '';
    const body = parsed.body && parsed.body !== '(Foto)'
      ? `<div class="community-post-body">${escapeHtml(parsed.body)}</div>` : '';
    const perfilHref = BASE + '/perfil';
    const borrar = p.mine
      ? `<button type="button" class="community-delete" data-del="${p.id}">Eliminar</button>` : '';
    return `<article class="community-post-card" data-post="${p.id}" data-tipo="${escapeHtml(parsed.tipo)}">
      <div class="community-post-card-head">
        <div class="community-post-avatar">${avatarAutor(p.autor)}</div>
        <div class="community-post-meta">
          <button type="button" class="community-post-author" data-perfil="${p.autor.id || ''}">${escapeHtml(p.autor.nombre_completo || 'Miembro')}</button>
          <div class="community-post-sub">${escapeHtml(tiempoRelativo(p.created_at))} · ${escapeHtml(tipoNombre)}</div>
        </div>
      </div>
      ${body}
      ${foto}
      <div class="community-post-actions">
        <button type="button" class="community-like${p.liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${p.liked}">♡ ${p.liked ? 'Apoyado' : 'Apoyar'}</button>
        <button type="button" class="community-conversar" data-conversar="${p.autor.id || ''}">Conversar</button>
        <button type="button" class="community-report" data-report="${p.id}">Reportar</button>
        ${borrar}
      </div>
    </article>`;
  }

  function pintarFeed(posts, { reemplazar }) {
    const filtered = posts.filter(p => tipoMatchesTab(parseContenido(p.contenido).tipo, feedTab));
    if (reemplazar) feedEl.innerHTML = '';
    if (!filtered.length && reemplazar) {
      feedEl.innerHTML = '<div class="community-feed-empty">Aún no hay publicaciones en este filtro. Sé la primera persona en compartir algo pequeño.</div>';
      return;
    }
    feedEl.insertAdjacentHTML('beforeend', filtered.map(tarjetaPost).join(''));
  }

  function renderIntentChips() {
    if (!intentChips) return;
    intentChips.innerHTML = TIPOS.map(t =>
      `<button type="button" class="community-intent-chip${t.id === selectedTipo ? ' on' : ''}" data-tipo="${t.id}" role="tab">${escapeHtml(t.label)}</button>`
    ).join('');
    intentChips.querySelectorAll('[data-tipo]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        selectedTipo = btn.getAttribute('data-tipo');
        renderIntentChips();
        const def = TIPOS.find(x => x.id === selectedTipo);
        if (composeLabel && def) composeLabel.textContent = def.composeLabel;
        if (postInput && def?.placeholder) postInput.placeholder = def.placeholder;
        postInput?.focus();
      });
    });
  }

  function renderFeedTabs() {
    if (!feedTabs) return;
    feedTabs.innerHTML = FEED_TABS.map(t =>
      `<button type="button" class="community-feed-tab${t.id === feedTab ? ' on' : ''}" data-tab="${t.id}" role="tab">${escapeHtml(t.label)}</button>`
    ).join('');
    feedTabs.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        feedTab = btn.getAttribute('data-tab');
        feed.page = 1;
        renderFeedTabs();
        if (feedTab === 'recientes') feed.orden = 'recientes';
        else feed.orden = 'recientes';
        cargarFeed({ reemplazar: true });
      });
    });
  }

  async function cargarFeed({ reemplazar }) {
    if (feed.cargando) return;
    if (!getToken()) {
      feedEl.innerHTML = '<div class="community-feed-empty">Inicia sesión para ver la comunidad.</div>';
      return;
    }
    feed.cargando = true;
    try {
      const qs = new URLSearchParams({ page: String(feed.page), limit: '10', orden: feed.orden });
      const res = await tribuFetch('/posts?' + qs);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error');
      let rows = json.data || [];
      rows = rows.filter(p => parseContenido(p.contenido).tipo !== 'logro_privado');
      if (reemplazar) feed.cache = rows;
      else feed.cache = feed.cache.concat(rows);
      feed.totalPages = json.totalPages || 1;
      feedMore.style.display = feed.page < feed.totalPages ? 'inline-flex' : 'none';
      pintarFeed(reemplazar ? rows : rows, { reemplazar });
    } catch (e) {
      console.error(e);
      if (reemplazar) {
        feedEl.innerHTML = '<div class="community-feed-empty">No pudimos cargar las publicaciones. Recarga la página.</div>';
      }
    } finally {
      feed.cargando = false;
    }
  }

  function initConfirmDialog() {
    document.getElementById('tribuConfirmCancel')?.addEventListener('click', () => cerrarTribuConfirm(false));
    document.getElementById('tribuConfirmOk')?.addEventListener('click', () => cerrarTribuConfirm(true));
    document.getElementById('tribuConfirmOverlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'tribuConfirmOverlay') cerrarTribuConfirm(false);
    });
  }

  function initFeedInteractions() {
    feedMore?.addEventListener('click', () => {
      feed.page++;
      cargarFeed({ reemplazar: false });
    });

    feedEl?.addEventListener('click', async (ev) => {
      const btnLike = ev.target.closest('[data-like]');
      const btnDel = ev.target.closest('[data-del]');
      const btnReport = ev.target.closest('[data-report]');
      const btnPerfil = ev.target.closest('.community-post-author');
      const btnConv = ev.target.closest('[data-conversar]');

      if (btnPerfil) {
        location.href = BASE + '/perfil';
        return;
      }
      if (btnConv) {
        showMessage('Pronto podrás enviar mensajes directos. Por ahora, apoya o responde en el feed.', 'info');
        return;
      }
      if (btnReport) {
        const ok = await mostrarTribuConfirm({
          title: 'Reportar publicación',
          message: '¿Quieres avisar al equipo de La Tribu sobre este contenido?',
        });
        if (ok) showMessage('Gracias. Revisaremos este contenido.', 'success');
        return;
      }
      if (btnLike) {
        const id = btnLike.getAttribute('data-like');
        btnLike.disabled = true;
        try {
          const res = await tribuFetch(`/posts/${id}/like`, { method: 'POST' });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          btnLike.classList.toggle('on', !!json.liked);
          btnLike.setAttribute('aria-pressed', json.liked ? 'true' : 'false');
          btnLike.textContent = json.liked ? '♡ Apoyado' : '♡ Apoyar';
        } catch (err) {
          showMessage(err.message || 'No se pudo registrar tu apoyo', 'error');
        } finally {
          btnLike.disabled = false;
        }
        return;
      }
      if (btnDel) {
        const id = btnDel.getAttribute('data-del');
        const ok = await mostrarTribuConfirm({
          title: 'Eliminar publicación',
          message: '¿Eliminar tu publicación?',
        });
        if (!ok) return;
        try {
          const res = await tribuFetch(`/posts/${id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error();
          feedEl.querySelector(`[data-post="${id}"]`)?.remove();
          if (!feedEl.querySelector('.community-post-card')) {
            feedEl.innerHTML = '<div class="community-feed-empty">Aún no hay publicaciones en este filtro.</div>';
          }
        } catch {
          showMessage('No se pudo eliminar', 'error');
        }
      }
    });
  }

  function limpiarComposer() {
    if (postInput) postInput.value = '';
  }

  function initPublicar() {
    postBtn?.addEventListener('click', async () => {
      const body = postInput?.value.trim() || '';
      if (!body) {
        showMessage('Escribe algo antes de compartir', 'error');
        return;
      }
      if (!getToken()) {
        requireAuth();
        return;
      }
      if (body.length > 2000) {
        showMessage('Máximo 2000 caracteres', 'error');
        return;
      }

      const payload = { contenido: encodeContenido(selectedTipo, body) };

      postBtn.disabled = true;
      const prev = postBtn.textContent;
      postBtn.textContent = 'Compartiendo…';
      try {
        const res = await tribuFetch('/posts', { method: 'POST', body: payload });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        limpiarComposer();
        showMessage('Compartido con la comunidad', 'success');
        if (json.post) {
          feed.page = 1;
          await cargarFeed({ reemplazar: true });
          feedEl.firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (err) {
        showMessage(err.message || 'Error al publicar', 'error');
      } finally {
        postBtn.disabled = false;
        postBtn.textContent = prev;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const ok = await MemberApp.init({ requireSub: true, layout: 'funnel' });
    if (!ok) return;
    initConfirmDialog();
    renderIntentChips();
    renderFeedTabs();
    initPublicar();
    initFeedInteractions();
    await cargarFeed({ reemplazar: true });
  });
})();
