// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
  // Initialize components
  initAvatarUpload();
  initPostEditor();
  initPostPhotoUpload();
  initPublicar();
  initFeed();
  initConfirmDialog();
  loadUserData();
  verificarSesion();
});

// DOM Elements
const pageLoader = document.getElementById('pageLoader');
const comunidadAvatarCircle = document.getElementById('comunidadAvatarCircle');
const comunidadAvatarSmall = document.getElementById('comunidadAvatarSmall');
const comunidadNombre = document.getElementById('comunidadNombre');
const comunidadTitulo = document.getElementById('comunidadTitulo');
const comunidadChips = document.getElementById('comunidadChips');
const comunidadFotoInput = document.getElementById('comunidadFoto');
const comunidadPostEditor = document.getElementById('comunidadPostEditor');
const comunidadPostBtn = document.getElementById('comunidadPostBtn');
const comunidadFotoBtn = document.getElementById('comunidadFotoBtn');
const comunidadPostFotoInput = document.getElementById('comunidadPostFoto');
const comunidadPostInput = document.getElementById('comunidadPostInput');
const comunidadPostFilename = document.getElementById('comunidadPostFilename');
const comunidadPostClearBtn = document.getElementById('comunidadPostClearBtn');
const comunidadPostMsg = document.getElementById('comunidadPostMsg');
const comunidadFeed = document.getElementById('comunidadFeed');
const comunidadFeedMore = document.getElementById('comunidadFeedMore');
const comunidadFeedOrden = document.getElementById('comunidadFeedOrden');

// State
let waPostEditor = null;
let selectedPostPhoto = null;
let userData = null;
const feed = { page: 1, totalPages: 1, orden: 'recientes', cargando: false };

const MAX_FOTO_BYTES = 5 * 1024 * 1024;

// Initialize avatar upload functionality
function initAvatarUpload() {
  // Click on avatar to open file picker
  comunidadAvatarCircle.addEventListener('click', function() {
    comunidadFotoInput.click();
  });
  
  // Handle file selection
  comunidadFotoInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      // Show preview
      const reader = new FileReader();
      reader.onload = function(event) {
        comunidadAvatarCircle.innerHTML = `<img src="${event.target.result}" alt="Avatar">`;
        comunidadAvatarSmall.innerHTML = `<img src="${event.target.result}" alt="Avatar">`;
      };
      reader.readAsDataURL(file);
      
      // In a real app, you would upload this to the server here
      showMessage('Foto seleccionada. En una implementación completa, se subiría al servidor.', 'info');
    }
  });
}

// Initialize WhatsApp-style editor for post creation
function initPostEditor() {
  if (waPostEditor) return;
  waPostEditor = WaEditor.create(comunidadPostEditor, {
    placeholder: 'Comparte algo con la comunidad...',
  });
}

// Initialize post photo upload functionality
function initPostPhotoUpload() {
  comunidadFotoBtn.addEventListener('click', function() {
    comunidadPostFotoInput.click();
  });
  
  comunidadPostFotoInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      // Comprobación rápida para dar feedback inmediato; el servidor valida los
      // bytes de verdad, así que esto no es la barrera de seguridad.
      if (!file.type.match('image.*')) {
        showMessage('Por favor selecciona un archivo de imagen válido', 'error');
        return;
      }
      if (file.size > MAX_FOTO_BYTES) {
        showMessage('La foto supera los 5 MB. Elige una más liviana.', 'error');
        comunidadPostFotoInput.value = '';
        return;
      }

      comunidadPostFilename.value = file.name;
      selectedPostPhoto = file;
      comunidadPostInput.style.display = 'flex';

      showMessage(`Foto seleccionada: ${file.name}`, 'success');
    }
  });
  
  comunidadPostClearBtn.addEventListener('click', function() {
    comunidadPostFotoInput.value = '';
    comunidadPostFilename.value = '';
    selectedPostPhoto = null;
    comunidadPostInput.style.display = 'none';
    showMessage('Foto eliminada', 'info');
  });
}

// Load user data from API
async function loadUserData() {
  const loaderText = document.getElementById('pageLoaderText');
  if (loaderText) loaderText.textContent = 'Cargando perfil...';
  showLoader(true);
  
  try {
    const response = await tribuFetch('/tribu-auth/me');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const user = await response.json();
    userData = user;
    displayUserData();
    
  } catch (error) {
    console.error('Error loading user data:', error);
    showMessage('Error al cargar los datos del usuario. Por favor intenta de nuevo.', 'error');
  } finally {
    showLoader(false);
  }
}

// Display user data in the UI
function displayUserData() {
  if (!userData) return;
  // Parse intereses and objetivos if they are strings
  if (typeof userData.intereses === 'string') {
    try {
      userData.intereses = JSON.parse(userData.intereses);
    } catch (e) {
      console.warn('Failed to parse intereses', e);
      userData.intereses = [];
    }
  } else if (!Array.isArray(userData.intereses)) {
    userData.intereses = [];
  }
  if (typeof userData.objetivos === 'string') {
    try {
      userData.objetivos = JSON.parse(userData.objetivos);
    } catch (e) {
      console.warn('Failed to parse objetivos', e);
      userData.objetivos = [];
    }
  } else if (!Array.isArray(userData.objetivos)) {
    userData.objetivos = [];
  }
  
  // Update name
  const nombreCompleto = `${userData.nombre || ''} ${userData.apellido || ''}`.trim();
  comunidadNombre.textContent = nombreCompleto || 'Usuario';
  comunidadTitulo.textContent = 'Mi perfil en la comunidad';
  
// Update avatar
   if (userData.foto_url) {
     const avatarImg = `<img src="${userData.foto_url}" alt="Avatar de ${userData.nombre}">`;
     comunidadAvatarCircle.innerHTML = avatarImg;
     comunidadAvatarSmall.innerHTML = avatarImg;
   } else {
     // Show initials
     const nombreFirst = userData.nombre && userData.nombre.length > 0 ? userData.nombre[0] : '';
     const apellidoFirst = userData.apellido && userData.apellido.length > 0 ? userData.apellido[0] : '';
     const initials = (nombreFirst + apellidoFirst).toUpperCase() || '?';
     comunidadAvatarCircle.textContent = initials;
     comunidadAvatarSmall.textContent = initials;
   }
  
  // Update chips (intereses and objetivos)
  updateChips();
}

// Update intereses and objetivos chips
function updateChips() {
  comunidadChips.innerHTML = '';
  
  // Add intereses chips
  if (userData.intereses && Array.isArray(userData.intereses)) {
    userData.intereses.forEach(interes => {
      if (interes && interes.trim() !== '') {
        const chip = document.createElement('div');
        chip.className = 'comunidad-chip';
        chip.innerHTML = `<span class="comunidad-chip-icon">🎯</span> ${interes.trim()}`;
        comunidadChips.appendChild(chip);
      }
    });
  }
  
  // Add objetivos chips
  if (userData.objetivos && Array.isArray(userData.objetivos)) {
    userData.objetivos.forEach(objetivo => {
      if (objetivo && objetivo.trim() !== '') {
        const chip = document.createElement('div');
        chip.className = 'comunidad-chip';
        chip.innerHTML = `<span class="comunidad-chip-icon">🏆</span> ${objetivo.trim()}`;
        comunidadChips.appendChild(chip);
      }
    });
  }
  
// If no chips, show a message
    if (comunidadChips.children.length === 0) {
      const noChips = document.createElement('div');
      noChips.className = 'comunidad-chip';
      noChips.style.color = 'var(--muted)';
      noChips.textContent = 'Aún no tienes intereses u objetivos definidos. Ve a tu perfil para agregarlos.';
      comunidadChips.appendChild(noChips);
    }
}

// Show/hide loader
function showLoader(show) {
  if (show) {
    pageLoader.classList.add('show');
  } else {
    pageLoader.classList.remove('show');
  }
}

// Show message in post section
function showMessage(message, type = 'info') {
  comunidadPostMsg.textContent = message;
  comunidadPostMsg.className = `comunidad-post-msg ${type}`;
  comunidadPostMsg.style.display = 'block';
  
  // Hide after 5 seconds for success/info messages
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      comunidadPostMsg.style.display = 'none';
    }, 5000);
  }
}

// El overlay de confirmacion vive en el HTML y cada pagina lo enlaza por su
// cuenta; sin esto mostrarTribuConfirm se queda esperando para siempre.
function initConfirmDialog() {
  document.getElementById('tribuConfirmCancel')?.addEventListener('click', () => cerrarTribuConfirm(false));
  document.getElementById('tribuConfirmOk')?.addEventListener('click', () => cerrarTribuConfirm(true));
  document.getElementById('tribuConfirmOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tribuConfirmOverlay') cerrarTribuConfirm(false);
  });
}

/** "hace 5 min", "ayer", etc. relative to now. */
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

/** Avatar del autor; si no tiene foto, sus iniciales. */
function avatarAutor(autor) {
  if (autor.foto_url) return `<img src="${escapeHtml(autor.foto_url)}" alt="">`;
  return escapeHtml(autor.iniciales || '?');
}

// El contenido llega como texto plano desde el textarea del editor, asi que se
// escapa siempre. No se usa innerHTML con lo que escribe el usuario.
function tarjetaPost(p) {
  const foto = p.foto_url
    ? `<img class="comunidad-card-photo" src="${escapeHtml(p.foto_url)}" alt="" loading="lazy">`
    : '';
  // Una publicacion puede no tener texto. "(Foto)" es el marcador que guardaba
  // el backend antes; sigue sin mostrarse para no romper las filas antiguas.
  const texto = (p.contenido && p.contenido !== '(Foto)')
    ? `<p class="comunidad-card-text">${escapeHtml(p.contenido)}</p>` : '';
  const editado = p.mine_edit ? '<span class="comunidad-card-tag">editado</span>' : '';
  const borrar = p.mine
    ? `<button type="button" class="comunidad-card-del" data-del="${p.id}">Eliminar</button>` : '';
  return `<article class="comunidad-card" data-post="${p.id}">
      <div class="comunidad-card-head">
        <div class="comunidad-card-avatar">${avatarAutor(p.autor)}</div>
        <div class="comunidad-card-meta">
          <span class="comunidad-card-name">${escapeHtml(p.autor.nombre_completo || 'Miembro')}</span>
          <span class="comunidad-card-time">${escapeHtml(tiempoRelativo(p.created_at))}</span>
        </div>
        ${editado}
      </div>
      ${texto}
      ${foto}
      <div class="comunidad-card-actions">
        <button type="button" class="comunidad-like${p.liked ? ' is-liked' : ''}" data-like="${p.id}" aria-pressed="${p.liked}">
          <span aria-hidden="true">${p.liked ? '💜' : '🤍'}</span>
          <span class="comunidad-like-count">${p.likes || 0}</span>
          <span class="comunidad-like-label">${p.liked ? 'Apoyado' : 'Apoyar'}</span>
        </button>
        ${borrar}
      </div>
    </article>`;
}

function pintarFeed(posts, { reemplazar }) {
  if (reemplazar) comunidadFeed.innerHTML = '';
  if (!posts.length && reemplazar) {
    comunidadFeed.innerHTML = '<div class="comunidad-feed-empty">Todavía no hay logros publicados. Sé la primera persona en compartir.</div>';
    return;
  }
  comunidadFeed.insertAdjacentHTML('beforeend', posts.map(tarjetaPost).join(''));
}

async function cargarFeed({ reemplazar = true } = {}) {
  if (feed.cargando) return;
  if (!getToken()) {
    comunidadFeed.innerHTML = '<div class="comunidad-feed-empty">Inicia sesión para ver los logros de la comunidad.</div>';
    return;
  }
  feed.cargando = true;
  try {
    const qs = new URLSearchParams({ page: String(feed.page), limit: '10', orden: feed.orden });
    const res = await tribuFetch(`/posts?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    feed.totalPages = json.totalPages || 1;
    pintarFeed(json.data || [], { reemplazar });
    comunidadFeedMore.style.display = feed.page < feed.totalPages ? 'inline-flex' : 'none';
  } catch (error) {
    console.error('Error al cargar el feed:', error);
    if (reemplazar) {
      comunidadFeed.innerHTML = '<div class="comunidad-feed-empty">No pudimos cargar los logros. Recarga la página para intentarlo de nuevo.</div>';
    }
  } finally {
    feed.cargando = false;
  }
}

function initFeed() {
  comunidadFeedMore?.addEventListener('click', () => { feed.page++; cargarFeed({ reemplazar: false }); });
  comunidadFeedOrden?.addEventListener('change', () => {
    feed.orden = comunidadFeedOrden.value;
    feed.page = 1;
    cargarFeed({ reemplazar: true });
  });

  // Un solo delegado para like y eliminar, en vez de uno por tarjeta.
  comunidadFeed?.addEventListener('click', async (ev) => {
    const btnLike = ev.target.closest('[data-like]');
    const btnDel = ev.target.closest('[data-del]');

    if (btnLike) {
      const id = btnLike.dataset.like;
      // Optimista: el contador se mueve ya y se revierte si el servidor dice que no.
      const previoLiked = btnLike.classList.contains('is-liked');
      const previoNum = Number(btnLike.querySelector('.comunidad-like-count').textContent) || 0;
      btnLike.classList.toggle('is-liked', !previoLiked);
      btnLike.querySelector('.comunidad-like-count').textContent = String(previoNum + (previoLiked ? -1 : 1));
      btnLike.querySelector('.comunidad-like-label').textContent = previoLiked ? 'Apoyar' : 'Apoyado';
      btnLike.disabled = true;
      try {
        const res = await tribuFetch(`/posts/${id}/like`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        btnLike.classList.toggle('is-liked', json.liked);
        btnLike.setAttribute('aria-pressed', String(json.liked));
        btnLike.querySelector('.comunidad-like-count').textContent = String(json.likes);
        btnLike.querySelector('.comunidad-like-label').textContent = json.liked ? 'Apoyado' : 'Apoyar';
      } catch (error) {
        console.error('Error al dar apoyo:', error);
        btnLike.classList.toggle('is-liked', previoLiked);
        btnLike.querySelector('.comunidad-like-count').textContent = String(previoNum);
        btnLike.querySelector('.comunidad-like-label').textContent = previoLiked ? 'Apoyado' : 'Apoyar';
      } finally {
        btnLike.disabled = false;
      }
      return;
    }

    if (btnDel) {
      const id = btnDel.dataset.del;
      const ok = await mostrarTribuConfirm({
        title: 'Eliminar publicación',
        message: 'Esta acción no se puede deshacer. ¿Quieres continuar?',
        confirmText: 'Eliminar', danger: true,
      });
      if (!ok) return;
      try {
        const res = await tribuFetch(`/posts/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        comunidadFeed.querySelector(`[data-post="${id}"]`)?.remove();
        if (!comunidadFeed.querySelector('.comunidad-card')) {
          feed.page = 1;
          cargarFeed({ reemplazar: true });
        }
      } catch (error) {
        console.error('Error al eliminar:', error);
        showMessage('No se pudo eliminar la publicación.', 'error');
      }
    }
  });

  cargarFeed({ reemplazar: true });
}

// Limpia el compositor tras publicar.
function limpiarComposer() {
  waPostEditor?.setValue('');
  comunidadPostFotoInput.value = '';
  comunidadPostFilename.value = '';
  selectedPostPhoto = null;
  comunidadPostInput.style.display = 'none';
}

// Handle post submission: publica de verdad contra POST /posts.
function initPublicar() {
  comunidadPostBtn.addEventListener('click', async function() {
    const contenido = waPostEditor ? waPostEditor.getValue().trim() : '';
    if (!contenido && !selectedPostPhoto) {
      showMessage('Escribe algo o adjunta una foto para publicar', 'error');
      return;
    }
    if (!getToken()) {
      requireAuth();
      return;
    }
    if (contenido.length > 2000) {
      showMessage(`Tu publicación tiene ${contenido.length} caracteres y el máximo es 2000.`, 'error');
      return;
    }

    const form = new FormData();
    form.append('contenido', contenido);
    if (selectedPostPhoto) form.append('foto', selectedPostPhoto, selectedPostPhoto.name);

    comunidadPostBtn.disabled = true;
    const textoBoton = comunidadPostBtn.textContent;
    comunidadPostBtn.textContent = 'Publicando...';
    try {
      const res = await tribuFetch('/posts', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      limpiarComposer();
      showMessage('¡Logro compartido con la comunidad!', 'success');
      // El post nuevo se inserta al principio en vez de recargar la pagina.
      if (json.post) pintarFeed([json.post], { reemplazar: false });
      comunidadFeed.firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      console.error('Error al publicar:', error);
      showMessage(error.message || 'Error al publicar. Por favor intenta de nuevo.', 'error');
    } finally {
      comunidadPostBtn.disabled = false;
      comunidadPostBtn.textContent = textoBoton;
    }
  });
}