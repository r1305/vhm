/* recursos.js — biblioteca guía #library */

let videosData = [];
let categoriasData = [];
let videoActual = null;
let filtroCategoria = 'all';
let busqueda = '';
let tagsData = [];
let filtroTags = new Set();
let perfilTagIds = [];
let recomendadosIds = [];
let ordenVista = 'para_ti';
let personalizado = false;

function getLikedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('vhm_liked_videos') || '[]')); } catch { return new Set(); }
}
function saveLikedSet(s) { localStorage.setItem('vhm_liked_videos', JSON.stringify([...s])); }
function esLiked(id) { return getLikedSet().has(id); }

function buildEmbed(url) {
  let m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return { type: 'iframe', src: `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0` };
  m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { type: 'iframe', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1` };
  m = String(url).match(/loom\.com\/(?:share|embed)\/([0-9a-f]{32})/i);
  if (m) return { type: 'iframe', src: `https://www.loom.com/embed/${m[1]}?autoplay=true` };
  return { type: 'video', src: url };
}

function duracionLabel(d) {
  const s = String(d || '').trim();
  if (!s) return '';
  if (/min/i.test(s)) return s;
  if (/^\d+$/.test(s)) return s + ' min';
  return s;
}

function tagsCardHtml(v) {
  const tags = Array.isArray(v.tags) ? v.tags : [];
  if (!tags.length) return '';
  const perfil = new Set(perfilTagIds);
  const visibles = tags
    .slice()
    .sort((a, b) => (perfil.has(b.id) ? 1 : 0) - (perfil.has(a.id) ? 1 : 0))
    .slice(0, 4);
  return `<div class="lib-guide-card-tags">${visibles.map(t =>
    `<span class="lib-guide-card-tag${perfil.has(t.id) ? ' match' : ''}">${escapeHtml(t.label)}</span>`
  ).join('')}</div>`;
}

function guideCardHtml(v) {
  const cat = escapeHtml((v.categoria_nombre || 'La Tribu').toUpperCase());
  const dur = escapeHtml(duracionLabel(v.duracion) || '');
  const meta = [dur, cat].filter(Boolean).join(' · ');
  const sub = escapeHtml(v.subtitulo || String(v.descripcion || '').slice(0, 120));
  const vid = Number.parseInt(v.id, 10) || 0;
  return `<button type="button" class="lib-guide-card" onclick="abrirVideo(${vid})">
    <div class="lib-guide-cover">
      <span class="lib-guide-cover-kicker">La Tribu · Guía práctica</span>
      <span class="lib-guide-cover-title">${escapeHtml(v.titulo || 'Recurso')}</span>
    </div>
    <div class="lib-guide-body">
      ${meta ? `<div class="lib-guide-meta">${meta}</div>` : ''}
      <h3>${escapeHtml(v.titulo || '')}</h3>
      <p>${sub || 'Contenido para acompañarte en tu camino.'}</p>
      ${tagsCardHtml(v)}
    </div>
  </button>`;
}

function bannerSinSuscripcion() {
  const logueado = !!window.tribuUser;
  return `<div class="lock-banner">
    <div class="lock-icon">🔒</div>
    <h3>${logueado ? 'Necesitas una suscripción activa' : 'Contenido exclusivo para miembros'}</h3>
    <p>${logueado ? `Hola ${escapeHtml(window.tribuUser.nombre)}, tu cuenta no tiene una suscripción activa.` : 'Inicia sesión o crea una cuenta para acceder a todos los recursos de La Tribu.'}</p>
    <div class="lock-btns">
      ${logueado
        ? `<button type="button" class="lock-btn" onclick="window.location.href='${BASE}/membresia'">Gestionar membresía</button>`
        : `<button type="button" class="lock-btn" onclick="window.location.href='${BASE}/camino?login=1'">Iniciar sesión</button>`
      }
    </div>
  </div>`;
}

function videosFiltrados() {
  const q = busqueda.trim().toLowerCase();
  const rows = videosData.filter(v => {
    if (filtroCategoria !== 'all' && String(v.categoria_id) !== String(filtroCategoria)) return false;
    if (filtroTags.size && !(v.tags || []).some(t => filtroTags.has(t.id))) return false;
    if (!q) return true;
    const tagsTxt = (v.tags || []).map(t => t.label).join(' ');
    const blob = `${v.titulo} ${v.subtitulo} ${v.descripcion || ''} ${v.categoria_nombre || ''} ${tagsTxt}`.toLowerCase();
    return blob.includes(q);
  });
  if (personalizado && ordenVista === 'catalogo') {
    rows.sort((a, b) => (a.posicion || 0) - (b.posicion || 0));
  }
  return rows;
}

function perfilTagsDisponibles() {
  const ids = new Set(tagsData.map(t => t.id));
  return perfilTagIds.filter(id => ids.has(id));
}

function renderTags() {
  const wrap = document.getElementById('libTags');
  if (!wrap) return;
  if (!tagsData.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  const perfil = perfilTagsDisponibles();
  const esPerfil = perfil.length > 0 && filtroTags.size === perfil.length && perfil.every(id => filtroTags.has(id));
  let html = '<span class="lib-guide-tags-label">Intereses y objetivos</span>';
  if (perfil.length) {
    html += `<button type="button" class="lib-guide-filter is-tag is-perfil${esPerfil ? ' on' : ''}" data-tag-perfil="1" aria-pressed="${esPerfil}">Mis intereses</button>`;
  }
  html += tagsData.map(t => {
    const on = filtroTags.has(t.id);
    const id = Number.parseInt(t.id, 10) || 0;
    return `<button type="button" class="lib-guide-filter is-tag${on ? ' on' : ''}" data-tag-id="${id}" aria-pressed="${on}">${escapeHtml(t.label)}</button>`;
  }).join('');
  if (filtroTags.size) {
    html += '<button type="button" class="lib-guide-filter is-tag" data-tag-clear="1">Quitar filtro</button>';
  }
  wrap.innerHTML = html;
}

function onTagsClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-tag-clear')) {
    filtroTags = new Set();
  } else if (btn.hasAttribute('data-tag-perfil')) {
    const perfil = perfilTagsDisponibles();
    const esPerfil = filtroTags.size === perfil.length && perfil.every(id => filtroTags.has(id));
    filtroTags = esPerfil ? new Set() : new Set(perfil);
  } else if (btn.hasAttribute('data-tag-id')) {
    const id = Number.parseInt(btn.getAttribute('data-tag-id'), 10);
    if (filtroTags.has(id)) filtroTags.delete(id); else filtroTags.add(id);
  } else {
    return;
  }
  renderTags();
  pintarGrid();
}

function pintarRecomendados() {
  const sec = document.getElementById('libReco');
  const grid = document.getElementById('libRecoGrid');
  if (!sec || !grid) return;
  const rows = recomendadosIds
    .map(id => videosData.find(v => v.id === id))
    .filter(Boolean);
  if (!rows.length) { sec.hidden = true; grid.innerHTML = ''; return; }
  sec.hidden = false;
  const locked = !tieneSuscripcion();
  grid.innerHTML = `<div class="lib-guide-grid ${locked ? 'tribu-locked' : ''}">${rows.map(guideCardHtml).join('')}</div>`;
}

function prepararOrden() {
  const wrap = document.getElementById('libOrderWrap');
  const sel = document.getElementById('libOrder');
  if (!wrap || !sel) return;
  const visible = personalizado && perfilTagIds.length > 0;
  wrap.hidden = !visible;
  if (!visible) ordenVista = 'catalogo';
  sel.value = ordenVista;
}

async function obtenerVideos() {
  if (window.tribuUser && typeof tribuFetch === 'function') {
    try {
      const res = await tribuFetch('/videos/para-ti');
      if (res.ok) {
        const d = await res.json();
        if (d && Array.isArray(d.videos)) {
          personalizado = true;
          perfilTagIds = Array.isArray(d.perfil_tag_ids) ? d.perfil_tag_ids : [];
          recomendadosIds = Array.isArray(d.recomendados) ? d.recomendados : [];
          return d.videos;
        }
      }
    } catch {}
  }
  const res = await fetch(`${API}/videos`);
  if (!res.ok) throw new Error();
  const d = await res.json();
  return Array.isArray(d) ? d : [];
}

function renderFiltros() {
  const wrap = document.getElementById('libFilters');
  if (!wrap) return;
  const chips = [{ id: 'all', label: 'Todo' }].concat(
    categoriasData.map(c => ({ id: String(c.id), label: c.nombre }))
  );
  wrap.innerHTML = chips.map(c =>
    `<button type="button" class="lib-guide-filter${filtroCategoria === c.id ? ' on' : ''}" data-cat="${escapeHtml(c.id)}" role="tab">${escapeHtml(c.label)}</button>`
  ).join('');
  wrap.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      filtroCategoria = btn.getAttribute('data-cat');
      renderFiltros();
      pintarGrid();
    });
  });
}

function pintarGrid() {
  const cont = document.getElementById('contenido');
  if (!cont) return;
  const rows = videosFiltrados();
  if (!rows.length) {
    cont.innerHTML = '<div class="member-empty">No hay recursos con este filtro. Prueba otra búsqueda o explora Todo.</div>';
    return;
  }
  const locked = !tieneSuscripcion();
  cont.innerHTML =
    `<div class="lib-guide-grid ${locked ? 'tribu-locked' : ''}">${rows.map(guideCardHtml).join('')}</div>`;
}

async function applyBibliotecaCopy() {
  if (typeof TribuContenido === 'undefined') return;
  const c = await TribuContenido.load('member_biblioteca');
  if (!c) return;
  TribuContenido.setText(document.querySelector('.member-page-eyebrow'), c.eyebrow);
  TribuContenido.setText(document.querySelector('.member-page-hero h1'), c.titulo);
  TribuContenido.setText(document.querySelector('.member-page-lead'), c.lead);
  TribuContenido.setText(document.querySelector('.lib-guide-main h2'), c.section_titulo);
  TribuContenido.setText(document.querySelector('.lib-guide-note'), c.nota);
  const lbl = document.querySelector('.lib-guide-search-label');
  const inp = document.getElementById('libSearch');
  if (lbl && c.search_label) lbl.textContent = c.search_label;
  if (inp && c.search_placeholder) inp.placeholder = c.search_placeholder;
}

async function cargar() {
  await applyBibliotecaCopy();
  const cont = document.getElementById('contenido');
  window._tribuLoaderStart();
  try {
    const [vData, cRes, tRes] = await Promise.all([
      obtenerVideos(),
      fetch(`${API}/videos/categorias`),
      fetch(`${API}/videos/tags`).catch(() => null),
    ]);
    videosData = vData;
    categoriasData = cRes.ok ? await cRes.json() : [];
    tagsData = tRes && tRes.ok ? await tRes.json() : [];
    if (!Array.isArray(videosData)) videosData = [];
    if (!Array.isArray(categoriasData)) categoriasData = [];
    if (!Array.isArray(tagsData)) tagsData = [];

    if (!videosData.length) {
      cont.innerHTML = '<div class="empty">Próximamente nuevos recursos disponibles.</div>';
      return;
    }

    renderFiltros();
    renderTags();
    prepararOrden();
    pintarRecomendados();
    pintarGrid();
    if (!tieneSuscripcion()) {
      cont.insertAdjacentHTML('beforebegin', bannerSinSuscripcion());
    }
    const playId = new URLSearchParams(location.search).get('play');
    if (playId) {
      const pid = parseInt(playId, 10);
      if (Number.isFinite(pid)) abrirVideo(pid);
    }
  } catch {
    cont.innerHTML = '<div class="empty">No se pudieron cargar los recursos.</div>';
  } finally {
    window._tribuLoaderEnd();
  }
}

function mostrarPaywallBiblioteca() {
  const cont = document.getElementById('contenido');
  if (cont && !cont.parentElement.querySelector('.lock-banner')) {
    cont.parentElement.insertAdjacentHTML('afterbegin', bannerSinSuscripcion());
  }
  document.querySelector('.lock-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function obtenerUrlVideo(id) {
  const res = await tribuFetch(`/videos/${id}/reproducir`);
  if (res.status === 401) { window.location.href = `${BASE}/camino?login=1`; return null; }
  if (res.status === 403) { mostrarPaywallBiblioteca(); return null; }
  if (!res.ok) throw new Error('No se pudo cargar el video');
  const d = await res.json();
  return d.video_url || null;
}

async function abrirVideo(id) {
  if (!window.tribuUser) { window.location.href = `${BASE}/camino?login=1`; return; }
  if (!tieneSuscripcion()) { mostrarPaywallBiblioteca(); return; }
  const v = videosData.find(x => x.id === id);
  if (!v) return;
  let videoUrl;
  try {
    videoUrl = await obtenerUrlVideo(id);
  } catch {
    alert('No se pudo cargar el video. Inténtalo de nuevo.');
    return;
  }
  if (!videoUrl) return;
  videoActual = v;
  const embed = buildEmbed(videoUrl);
  document.getElementById('playerMount').innerHTML = embed.type === 'iframe'
    ? `<iframe src="${escapeHtml(embed.src)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`
    : `<video src="${escapeHtml(embed.src)}" controls autoplay></video>`;
  document.getElementById('pTitulo').textContent = v.titulo;
  document.getElementById('pSub').textContent = v.subtitulo || '';
  document.getElementById('pDesc').textContent = v.descripcion || '';
  document.getElementById('pVistas').textContent = `👁️ ${v.vistas} vistas`;
  actualizarBotonLike();
  document.getElementById('playerOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  try {
    const res = await fetch(`${API}/videos/${id}/vista`, { method: 'POST' });
    const d = await res.json();
    if (d.vistas != null) { v.vistas = d.vistas; document.getElementById('pVistas').textContent = `👁️ ${d.vistas} vistas`; }
  } catch {}
}

function cerrarPlayer() {
  document.getElementById('playerMount').innerHTML = '';
  document.getElementById('playerOverlay').classList.remove('show');
  document.body.style.overflow = '';
  videoActual = null;
  pintarGrid();
}

function actualizarBotonLike() {
  if (!videoActual) return;
  const liked = esLiked(videoActual.id);
  const btn = document.getElementById('pLike');
  btn.classList.toggle('liked', liked);
  btn.querySelector('#pLikeCount').textContent = videoActual.likes;
  btn.childNodes[0].nodeValue = liked ? '❤️ ' : '🤍 ';
}

async function toggleLike() {
  if (!videoActual) return;
  const set = getLikedSet();
  const yaLiked = set.has(videoActual.id);
  try {
    const res = await fetch(`${API}/videos/${videoActual.id}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quitar: yaLiked }) });
    const d = await res.json();
    if (d.likes != null) videoActual.likes = d.likes;
    if (yaLiked) set.delete(videoActual.id); else set.add(videoActual.id);
    saveLikedSet(set);
    actualizarBotonLike();
  } catch {}
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarPlayer(); });

document.getElementById('libSearch')?.addEventListener('input', (e) => {
  busqueda = e.target.value;
  pintarGrid();
});

document.getElementById('libTags')?.addEventListener('click', onTagsClick);

document.getElementById('libOrder')?.addEventListener('change', (e) => {
  ordenVista = e.target.value === 'catalogo' ? 'catalogo' : 'para_ti';
  pintarGrid();
});

window.cargarRecursosBiblioteca = cargar;
