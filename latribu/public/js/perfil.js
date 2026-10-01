/* perfil.js */

let quillHobbies = null;
let quillDedicas = null;
let isEditMode = false;
const EMOJIS = ['😊','😂','🥰','😎','🤩','🙌','💪','🎉','🔥','✨','💡','🎯','🌟','🚀','💼','📚','🎨','🎵','🏋️','🧘','🌿','🍀','🐾','✈️','🌍','🏠','❤️','💙','💚','💛','🧡','💜','🤝','👏','🙏','💬','📝','🎓','🏆','⭐'];

// Catálogo de chips (intereses/objetivos) - se carga desde la API
let _chipsCatalogo = { intereses: [], objetivos: [] };
let _chipsSeleccionados = { intereses: [], objetivos: [] };

// Alias para compatibilidad con el modal de completar perfil (funciones cp*)
const _cpCatalogo = _chipsCatalogo;
let _cpInteresesSel = _chipsSeleccionados.intereses;
let _cpObjetivosSel = _chipsSeleccionados.objetivos;
let _cpStep = 0;

function setQuillHTML(quill, html) {
  if (!quill) return;
  try {
    quill.clipboard.dangerouslyPasteHTML(html || '');
  } catch {
    quill.root.innerHTML = html || '';
  }
}

/* ── Loader ── */
function showLoader(text) {
  const el = document.getElementById('pageLoader');
  const txt = document.getElementById('pageLoaderText');
  if (txt) txt.textContent = text || 'Cargando...';
  if (el) el.classList.add('show');
}
function hideLoader() {
  document.getElementById('pageLoader')?.classList.remove('show');
}

/* ── Quill ── */
function initQuillEditors() {
  if (quillHobbies) return;
  const toolbarOptions = [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'], ['clean'],
  ];
  quillHobbies = new Quill('#pfHobbiesEditor', {
    theme: 'snow',
    placeholder: 'Cuéntanos qué te apasiona, qué haces en tu tiempo libre...',
    modules: { toolbar: toolbarOptions },
  });
  quillDedicas = new Quill('#pfDedicasEditor', {
    theme: 'snow',
    placeholder: 'Cuéntanos a qué te dedicas, tu trabajo, proyectos...',
    modules: { toolbar: toolbarOptions },
  });
  ['hobbiesEmoji', 'dedicasEmoji'].forEach(id => {
    const grid = document.getElementById(id);
    if (!grid) return;
    grid.innerHTML = EMOJIS.map(e =>
      `<button type="button" onclick="insertEmoji('${id}','${e}')">${e}</button>`
    ).join('');
  });
}

/* ── View/Edit toggle ── */
async function setEditMode(edit) {
  isEditMode = edit;
  document.body.classList.toggle('edit-mode', edit);
  document.body.classList.toggle('view-mode', !edit);
  document.getElementById('profileActionsView').style.display = edit ? 'none' : 'flex';
  document.getElementById('profileActionsEdit').style.display = edit ? 'flex' : 'none';
  document.getElementById('chipsSection').style.display = edit ? 'none' : 'block';
  // Habilitar/deshabilitar editores Quill
  setQuillReadonly(quillHobbies, !edit);
  setQuillReadonly(quillDedicas, !edit);

  if (edit) {
    // Entrando a editar: cargar catálogo si no está cargado y renderizar chips editables
    if (!_chipsCatalogo.intereses.length && !_chipsCatalogo.objetivos.length) {
      await cargarCatalogoChips();
    }
    const u = window.tribuUser;
    _chipsSeleccionados.intereses = [...(u.intereses || [])];
    _chipsSeleccionados.objetivos = [...(u.objetivos || [])];
    renderEditChips('chipsIntereses', _chipsCatalogo.intereses, _chipsSeleccionados.intereses, 6, 'intereses');
    renderEditChips('chipsObjetivos', _chipsCatalogo.objetivos, _chipsSeleccionados.objetivos, 3, 'objetivos');
    document.getElementById('chipsSection').style.display = 'block';
  } else {
    // Saliendo de editar: chips vuelven a solo visuales (ya actualizados en _chipsSeleccionados)
    document.getElementById('chipsSection').style.display = (_chipsSeleccionados.intereses.length || _chipsSeleccionados.objetivos.length) ? 'block' : 'none';
  }
}

function toggleEditMode() {
  setEditMode(!isEditMode);
}

function toggleEditMode() {
  setEditMode(!isEditMode);
}

function toggleEmojiPicker(id, e) {
  e.stopPropagation();
  const grid = document.getElementById(id);
  if (!grid) return;
  const isOpen = grid.classList.contains('open');
  document.querySelectorAll('.emoji-grid.open').forEach(g => g.classList.remove('open'));
  if (!isOpen) grid.classList.add('open');
}

function insertEmoji(gridId, emoji) {
  const quill = gridId === 'hobbiesEmoji' ? quillHobbies : quillDedicas;
  if (!quill) return;
  const range = quill.getSelection(true);
  quill.insertText(range.index, emoji);
  quill.setSelection(range.index + emoji.length);
  document.getElementById(gridId)?.classList.remove('open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.emoji-grid.open').forEach(g => g.classList.remove('open'));
});

/* ── Avatar ── */
function renderAvatar() {
  const circle = document.getElementById('avatarCircle');
  const removeBtn = document.getElementById('avatarRemoveBtn');
  if (!circle || !window.tribuUser) return;
  const u = window.tribuUser;
  if (u.foto_url) {
    circle.innerHTML = `<img src="${escapeHtml(u.foto_url)}" alt="Foto de perfil">`;
    if (removeBtn) removeBtn.classList.add('show');
  } else {
    const initial = escapeHtml((u.nombre || '?').charAt(0).toUpperCase());
    circle.textContent = initial;
    if (removeBtn) removeBtn.classList.remove('show');
  }
}

function setAvatarPreview(src) {
  const circle = document.getElementById('avatarCircle');
  if (circle) circle.innerHTML = `<img src="${escapeHtml(src)}" alt="Vista previa">`;
}

async function onFotoSelected() {
  const input = document.getElementById('pfFoto');
  if (!input?.files?.length) return;
  const file = input.files[0];

  // Preview inmediato
  const reader = new FileReader();
  reader.onload = e => setAvatarPreview(e.target.result);
  reader.readAsDataURL(file);

  // Subir
  showLoader('Subiendo foto...');
  const fd = new FormData();
  fd.append('foto', file);
  try {
    const res = await tribuFetch('/tribu-auth/perfil/foto', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) { setProfileMsg(d.error || 'Error al subir foto', false); renderAvatar(); return; }
    window.tribuUser = normalizarSuscripcionUsuario(d.user);
    setStoredUser(window.tribuUser);
    input.value = '';
    renderNavAuth();
    renderAvatar();
    setProfileMsg('Foto actualizada', true);
  } catch {
    setProfileMsg('Error de conexión', false);
    renderAvatar();
  } finally {
    hideLoader();
  }
}

async function quitarFotoPerfil() {
  showLoader('Quitando foto...');
  try {
    const res = await tribuFetch('/tribu-auth/perfil/foto', { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { setProfileMsg(d.error || 'Error', false); return; }
    window.tribuUser = normalizarSuscripcionUsuario(d.user);
    setStoredUser(window.tribuUser);
    renderNavAuth();
    renderAvatar();
    setProfileMsg('Foto eliminada', true);
  } catch {
    setProfileMsg('Error de conexión', false);
  } finally {
    hideLoader();
  }
}

function setQuillReadonly(quill, readonly) {
  if (!quill) return;
  if (readonly) {
    quill.enable(false);
    quill.root.classList.add('quill-readonly');
  } else {
    quill.enable(true);
    quill.root.classList.remove('quill-readonly');
  }
}

/* ── Chip Catalog & Editing ── */
async function cargarCatalogoChips() {
  try {
    const res = await fetch(`${API}/tribu-catalogo/intereses`);
    const d = await res.json();
    if (d.activo) _chipsCatalogo.intereses = d.data || [];
  } catch {
    _chipsCatalogo.intereses = [];
  }
  try {
    const res = await fetch(`${API}/tribu-catalogo/objetivos`);
    const d = await res.json();
    if (d.activo) _chipsCatalogo.objetivos = d.data || [];
  } catch {
    _chipsCatalogo.objetivos = [];
  }
}

function renderEditChips(containerId, options, selected, max, tipo) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = options.map(opt =>
    '<button type="button" class="tribu-cp-chip' + (selected.includes(opt) ? ' selected' : '') + '"' +
    ' onclick="togglePerfilChip(this,\'' + containerId + '\',\'' + escapeHtml(opt) + '\',' + max + ')">' +
    escapeHtml(opt) + '</button>'
  ).join('');
}

function togglePerfilChip(btn, containerId, opt, max) {
  const tipo = containerId === 'chipsIntereses' ? 'intereses' : 'objetivos';
  const maxSel = tipo === 'intereses' ? 6 : 3;
  const arr = _chipsSeleccionados[tipo];
  const idx = arr.indexOf(opt);
  if (idx >= 0) {
    arr.splice(idx, 1);
    btn.classList.remove('selected');
  } else if (arr.length < maxSel) {
    arr.push(opt);
    btn.classList.add('selected');
  } else {
    return; // límite alcanzado
  }
  // Actualizar display de chips seleccionados
  renderChips(tipo === 'intereses' ? 'chipsIntereses' : 'chipsObjetivos', arr, tipo);
}

function renderCpChips(containerId, options, selected, max, limitId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.innerHTML = options.map(opt =>
    '<button type="button" class="tribu-cp-chip' + (selected.includes(opt) ? ' selected' : '') + '"' +
    ' onclick="togglePerfilChip(this,\'' + containerId + '\',\'' + escapeHtml(opt) + '\',' + max + ')">' +
    escapeHtml(opt) + '</button>'
  ).join('');
  document.getElementById(limitId).textContent = selected.length + ' / ' + max + ' seleccionados';
}

/* ── Modal Completar Perfil (3 pasos) ── */
async function abrirModalPerfil() {
  // Cargar catálogo faltante (intereses u objetivos) independientemente
  if (!_chipsCatalogo.intereses.length || !_chipsCatalogo.objetivos.length) {
    await cargarCatalogoChips();
  }
  const u = window.tribuUser;
  _cpInteresesSel = [...(u.intereses || [])];
  _cpObjetivosSel = [...(u.objetivos || [])];

  // Paso 1: precargar datos
  document.getElementById('cpNombre').value = u.nombre || '';
  document.getElementById('cpApellido').value = u.apellido || '';
  document.getElementById('cpCiudad').value = u.ciudad || '';
  document.getElementById('cpCarrera').value = u.carrera || '';
  const avatarCircle = document.getElementById('cpAvatarCircle');
  const avatarRemoveBtn = document.getElementById('cpAvatarRemoveBtn');
  if (u.foto_url) {
    avatarCircle.innerHTML = `<img src="${escapeHtml(u.foto_url)}" alt="Foto de perfil">`;
    document.getElementById('cpAvatarRemoveBtn').style.display = 'flex';
  } else {
    const initial = escapeHtml((u.nombre || '?').charAt(0).toUpperCase());
    avatarCircle.textContent = initial;
    document.getElementById('cpAvatarRemoveBtn').style.display = 'none';
  }

  // Renderizar chips
  renderCpChips('cpInteresesChips', _cpCatalogo.intereses, _cpInteresesSel, 6, 'cpInteresesLimit');
  renderCpChips('cpObjetivosChips', _cpCatalogo.objetivos, _cpObjetivosSel, 3, 'cpObjetivosLimit');

  // Reset a paso 1
  _cpStep = 0;
  cpShowStep(0);

  document.getElementById('cpOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function cerrarCpModal() {
  document.getElementById('cpOverlay').classList.remove('show');
  document.body.style.overflow = '';
  // Limpiar errores
  document.getElementById('cpErr1').textContent = '';
  document.getElementById('cpErr2').textContent = '';
}

function cpShowStep(step) {
  _cpStep = step;
  document.querySelectorAll('.tribu-cp-step-content').forEach((el, i) => {
    el.style.display = i === step ? 'block' : 'none';
  });
  document.querySelectorAll('.tribu-cp-step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i <= step);
    dot.classList.toggle('done', i < step);
  });
  // Mostrar/ocultar botón volver
  document.querySelectorAll('.tribu-cp-btn-back').forEach(btn => {
    btn.style.display = step > 0 ? 'inline-flex' : 'none';
  });
}

function cpNext(step) {
  if (step === 0) {
    // Validar paso 1
    const nombre = document.getElementById('cpNombre').value.trim();
    const apellido = document.getElementById('cpApellido').value.trim();
    if (!nombre || !apellido) {
      document.getElementById('cpErr1').textContent = 'Nombre y apellido son obligatorios';
      return;
    }
    cpShowStep(1);
  } else if (step === 1) {
    if (_cpInteresesSel.length === 0) {
      document.getElementById('cpErr1').textContent = 'Elige al menos un interés';
      return;
    }
    cpShowStep(2);
  }
}

function cpBack(step) {
  cpShowStep(step - 1);
}

async function cpGuardar() {
  if (_cpObjetivosSel.length === 0) {
    document.getElementById('cpErr2').textContent = 'Elige al menos una opción';
    return;
  }
  const btn = document.getElementById('cpSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    // Paso 1: guardar datos básicos
    const r1 = await tribuFetch('/tribu-auth/perfil', {
      method: 'PUT',
      body: {
        nombre: document.getElementById('cpNombre').value.trim(),
        apellido: document.getElementById('cpApellido').value.trim(),
        ciudad: document.getElementById('cpCiudad').value.trim(),
        carrera: document.getElementById('cpCarrera').value.trim(),
        // foto se sube por separado si hay cambio
      },
    });
    if (!r1.ok) throw new Error((await r1.json()).error || 'Error al guardar datos');

    // Paso 2+3: guardar ciudad, intereses, objetivos
    const r2 = await tribuFetch('/tribu-auth/perfil/comunidad', {
      method: 'PUT',
      body: {
        ciudad: document.getElementById('cpCiudad').value.trim(),
        intereses: _cpInteresesSel,
        objetivos: _cpObjetivosSel,
      },
    });
    if (!r2.ok) throw new Error((await r2.json()).error || 'Error al guardar intereses/objetivos');
    const d2 = await r2.json();
    if (d2.token) setToken(d2.token);

    // Actualizar estado local
    window.tribuUser = normalizarSuscripcionUsuario(d2.user);
    setStoredUser(window.tribuUser);
    renderNavAuth();

    // Recargar formulario para reflejar cambios
    await fillPerfilForm();
    cerrarCpModal();
    setProfileMsg('Perfil completado correctamente', true);
  } catch (err) {
    document.getElementById('cpErr1').textContent = err.message || 'Error al guardar';
  }
}

function onCpFotoSelected() {
  const input = document.getElementById('cpFoto');
  if (!input?.files?.length) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('cpAvatarCircle').innerHTML = `<img src="${escapeHtml(e.target.result)}" alt="Vista previa">`;
    document.getElementById('cpAvatarRemoveBtn').style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

async function quitarCpFoto() {
  try {
    const res = await tribuFetch('/tribu-auth/perfil/foto', { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al quitar foto');
    document.getElementById('cpAvatarCircle').textContent = escapeHtml((document.getElementById('cpNombre').value || '?').charAt(0).toUpperCase());
    document.getElementById('cpAvatarRemoveBtn').style.display = 'none';
  } catch {
    // silencioso
  }
}

/* ── Formulario ── */
function fillPerfilForm() {
  const u = window.tribuUser;
  if (!u) return;
  document.getElementById('pfNombre').value = u.nombre || '';
  document.getElementById('pfApellido').value = u.apellido || '';
  document.getElementById('pfEmail').value = u.email || '';
  document.getElementById('pfTelefono').value = u.telefono || '';
  document.getElementById('pfCarrera').value = u.carrera || '';
  if (quillHobbies) setQuillHTML(quillHobbies, u.hobbies || '');
  if (quillDedicas) setQuillHTML(quillDedicas, u.a_que_te_dedicas || '');

  // Iniciar en modo vista (readonly)
  setQuillReadonly(quillHobbies, true);
  setQuillReadonly(quillDedicas, true);

  // Chips: intereses / objetivos (solo visuales)
  renderChips('chipsIntereses', u.intereses || [], 'intereses');
  renderChips('chipsObjetivos', u.objetivos || [], 'objetivos');
  document.getElementById('chipsSection').style.display = (u.intereses?.length || u.objetivos?.length) ? 'block' : 'none';

  document.getElementById('profileHeading').textContent = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
  renderAvatar();
  const msg = document.getElementById('pfMsg');
  if (msg) { msg.textContent = ''; msg.className = 'profile-msg'; }

  // Iniciar en modo vista (readonly)
  setEditMode(false);
}

function setProfileMsg(text, ok) {
  const el = document.getElementById('pfMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'profile-msg ' + (ok ? 'ok' : 'err');
}

function parseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

function renderChips(containerId, items, tipo) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const arr = parseArray(items);
  if (!arr.length) { container.innerHTML = ''; return; }
  container.innerHTML = arr.map(item =>
    `<span class="chip">${escapeHtml(item)}</span>`
  ).join('');
}

function quitarChip(tipo, valor) {
  // Chips son solo visuales en perfil; la gestión se hace en el modal de onboarding (cpModal)
}

async function guardarPerfil() {
  const btn = document.getElementById('pfSaveBtn');
  btn.disabled = true;
  showLoader('Guardando perfil...');
  try {
    const res = await tribuFetch('/tribu-auth/perfil', {
      method: 'PUT',
      body: {
        nombre: document.getElementById('pfNombre').value.trim(),
        apellido: document.getElementById('pfApellido').value.trim(),
        email: document.getElementById('pfEmail').value.trim(),
        telefono: document.getElementById('pfTelefono').value.trim(),
        carrera: document.getElementById('pfCarrera').value.trim(),
        hobbies: quillHobbies ? quillHobbies.root.innerHTML : '',
        a_que_te_dedicas: quillDedicas ? quillDedicas.root.innerHTML : '',
        intereses: _chipsSeleccionados.intereses,
        objetivos: _chipsSeleccionados.objetivos,
      },
    });
    const d = await res.json();
    if (!res.ok) { setProfileMsg(d.error || 'Error al guardar', false); return; }
    if (d.token) setToken(d.token);
    window.tribuUser = normalizarSuscripcionUsuario(d.user);
    setStoredUser(window.tribuUser);
    renderNavAuth();
    fillPerfilForm();
    setProfileMsg('Perfil actualizado correctamente', true);
  } catch {
    setProfileMsg('Error de conexión', false);
  } finally {
    btn.disabled = false;
    hideLoader();
  }
}

/* ── Init ── */
(async () => {
  if (!requireAuth()) return;
  showLoader('Cargando perfil...');
  try {
    const ok = await verificarSesion();
    if (!ok) { window.location.href = BASE + '/?login=1'; return; }
    initQuillEditors();
    fillPerfilForm();
    const res = await tribuFetch('/tribu-auth/me');
    if (res.ok) {
      window.tribuUser = normalizarSuscripcionUsuario(await res.json());
      setStoredUser(window.tribuUser);
      fillPerfilForm();
      renderNavAuth();
    }

    // Event listeners para el modal de completar perfil
    document.getElementById('cpCloseBtn')?.addEventListener('click', cerrarCpModal);
    document.getElementById('cpOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'cpOverlay') cerrarCpModal();
    });
    document.getElementById('cpFoto')?.addEventListener('change', onCpFotoSelected);
    document.getElementById('cpAvatarRemoveBtn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); quitarCpFoto();
    });
  } finally {
    hideLoader();
  }
})();