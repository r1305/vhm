/* recursos.js */

let videosData = [];
let videoActual = null;

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

function cardHtml(v) {
  const liked = esLiked(v.id);
  return `<div class="card" onclick="abrirVideo(${v.id})">
    <div class="thumb">
      ${v.thumbnail_url ? `<img src="${escapeHtml(v.thumbnail_url)}" alt="${escapeHtml(v.titulo)}" loading="lazy">` : ''}
      <div class="play"><span>&#9654;</span></div>
      ${v.duracion ? `<div class="dur">${escapeHtml(v.duracion)}</div>` : ''}
    </div>
    <div class="card-body">
      <h3>${escapeHtml(v.titulo)}</h3>
      <div class="sub">${escapeHtml(v.subtitulo || '')}</div>
      <div class="card-meta">
        <span>👁️ ${v.vistas} vistas</span>
        <button class="like-btn ${liked ? 'liked' : ''}" onclick="event.stopPropagation();likeRapido(${v.id},this)">
          ${liked ? '❤️' : '🤍'} <span>${v.likes}</span>
        </button>
      </div>
    </div>
  </div>`;
}

function categoriaHtml(titulo, descripcion, videosHtml, count) {
  const id = 'cat-' + Math.random().toString(36).slice(2, 8);
  return `<div class="cat-accordion">
    <button type="button" class="cat-accordion-trigger" aria-expanded="false" aria-controls="${id}">
      <span class="cat-title-main">${escapeHtml(titulo)}<span class="cat-accordion-count">${count} recurso${count === 1 ? '' : 's'}</span></span>
      <span class="cat-accordion-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="cat-accordion-panel" id="${id}">
      ${descripcion ? `<p class="cat-desc">${escapeHtml(descripcion)}</p>` : ''}
      <div class="grid ${tieneSuscripcion() ? '' : 'tribu-locked'}">${videosHtml}</div>
    </div>
  </div>`;
}

function bannerSinSuscripcion() {
  const logueado = !!window.tribuUser;
  return `<div class="lock-banner">
    <div class="lock-icon">🔒</div>
    <h3>${logueado ? 'Necesitas una suscripción activa' : 'Contenido exclusivo para miembros'}</h3>
    <p>${logueado ? `Hola ${escapeHtml(window.tribuUser.nombre)}, tu cuenta no tiene una suscripción activa.` : 'Inicia sesión o crea una cuenta para acceder a todos los recursos de La Tribu.'}</p>
    <div class="lock-btns">
      ${logueado
        ? `<button class="lock-btn lock-btn-primary" onclick="window.location.href='${BASE}/suscripciones'">Ver planes</button>`
        : `<button class="lock-btn lock-btn-primary" onclick="window.location.href='${BASE}/?login=1'">Iniciar sesión</button>`
      }
    </div>
  </div>`;
}

async function cargar() {
  const cont = document.getElementById('contenido');
  try {
    const [vRes, cRes] = await Promise.all([fetch(`${API}/videos`), fetch(`${API}/videos/categorias`)]);
    if (!vRes.ok) throw new Error();
    videosData = await vRes.json();
    const categorias = cRes.ok ? await cRes.json() : [];

    if (!videosData.length) {
      cont.innerHTML = '<div class="empty">Próximamente nuevos recursos disponibles.</div>';
      return;
    }

    let html = '';
    categorias.forEach(cat => {
      const vids = videosData.filter(v => v.categoria_id === cat.id);
      if (!vids.length) return;
      html += categoriaHtml(cat.nombre, cat.descripcion || '', vids.map(cardHtml).join(''), vids.length);
    });
    const sinCat = videosData.filter(v => !v.categoria_id);
    if (sinCat.length) html += categoriaHtml('Otros recursos', '', sinCat.map(cardHtml).join(''), sinCat.length);

    cont.innerHTML = html;
    cont.querySelectorAll('.cat-accordion-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const acc = btn.closest('.cat-accordion');
        const open = !acc.classList.contains('is-open');
        acc.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    if (!tieneSuscripcion()) cont.insertAdjacentHTML('afterbegin', bannerSinSuscripcion());
  } catch {
    cont.innerHTML = '<div class="empty">No se pudieron cargar los recursos.</div>';
  }
}

async function abrirVideo(id) {
  if (!window.tribuUser) { window.location.href = `${BASE}/?login=1`; return; }
  if (!tieneSuscripcion()) {
    const cont = document.getElementById('contenido');
    if (!cont.querySelector('.lock-banner')) cont.insertAdjacentHTML('afterbegin', bannerSinSuscripcion());
    cont.querySelector('.lock-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  cargar();
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

async function likeRapido(id, btn) {
  const v = videosData.find(x => x.id === id);
  if (!v) return;
  const set = getLikedSet();
  const yaLiked = set.has(id);
  try {
    const res = await fetch(`${API}/videos/${id}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quitar: yaLiked }) });
    const d = await res.json();
    if (d.likes != null) v.likes = d.likes;
    if (yaLiked) set.delete(id); else set.add(id);
    saveLikedSet(set);
    btn.classList.toggle('liked', !yaLiked);
    btn.childNodes[0].nodeValue = (!yaLiked ? '❤️' : '🤍') + ' ';
    btn.querySelector('span').textContent = v.likes;
  } catch {}
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarPlayer(); });

verificarSesion().then(cargar);
