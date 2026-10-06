/* recursos.js — biblioteca guía #library */

let videosData = [];
let categoriasData = [];
let videoActual = null;
let filtroCategoria = 'all';
let busqueda = '';

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

function guideCardHtml(v) {
  const cat = escapeHtml((v.categoria_nombre || 'La Tribu').toUpperCase());
  const dur = escapeHtml(duracionLabel(v.duracion) || '');
  const meta = [dur, cat].filter(Boolean).join(' · ');
  const sub = escapeHtml(v.subtitulo || String(v.descripcion || '').slice(0, 120));
  return `<button type="button" class="lib-guide-card" onclick="abrirVideo(${v.id})">
    <div class="lib-guide-cover">
      <span class="lib-guide-cover-kicker">La Tribu · Guía práctica</span>
      <span class="lib-guide-cover-title">${escapeHtml(v.titulo || 'Recurso')}</span>
    </div>
    <div class="lib-guide-body">
      ${meta ? `<div class="lib-guide-meta">${meta}</div>` : ''}
      <h3>${escapeHtml(v.titulo || '')}</h3>
      <p>${sub || 'Contenido para acompañarte en tu camino.'}</p>
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
  return videosData.filter(v => {
    if (filtroCategoria !== 'all' && String(v.categoria_id) !== String(filtroCategoria)) return false;
    if (!q) return true;
    const blob = `${v.titulo} ${v.subtitulo} ${v.descripcion || ''} ${v.categoria_nombre || ''}`.toLowerCase();
    return blob.includes(q);
  });
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
  TribuContenido.setText(document.querySelector('.lib-guide-section h2'), c.section_titulo);
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
    const [vRes, cRes] = await Promise.all([fetch(`${API}/videos`), fetch(`${API}/videos/categorias`)]);
    if (!vRes.ok) throw new Error();
    videosData = await vRes.json();
    categoriasData = cRes.ok ? await cRes.json() : [];
    if (!Array.isArray(videosData)) videosData = [];
    if (!Array.isArray(categoriasData)) categoriasData = [];

    if (!videosData.length) {
      cont.innerHTML = '<div class="empty">Próximamente nuevos recursos disponibles.</div>';
      return;
    }

    renderFiltros();
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

async function abrirVideo(id) {
  if (!window.tribuUser) { window.location.href = `${BASE}/camino?login=1`; return; }
  if (!tieneSuscripcion()) {
    const cont = document.getElementById('contenido');
    if (cont && !cont.parentElement.querySelector('.lock-banner')) {
      cont.parentElement.insertAdjacentHTML('afterbegin', bannerSinSuscripcion());
    }
    document.querySelector('.lock-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const v = videosData.find(x => x.id === id);
  if (!v) return;
  videoActual = v;
  const embed = buildEmbed(v.video_url);
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

window.cargarRecursosBiblioteca = cargar;
