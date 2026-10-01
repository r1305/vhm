/* perfil.js */

let quillHobbies = null;
let quillDedicas = null;
let isEditMode = false;
const EMOJIS = ['😊','😂','🥰','😎','🤩','🙌','💪','🎉','🔥','✨','💡','🎯','🌟','🚀','💼','📚','🎨','🎵','🏋️','🧘','🌿','🍀','🐾','✈️','🌍','🏠','❤️','💙','💚','💛','🧡','💜','🤝','👏','🙏','💬','📝','🎓','🏆','⭐'];

function setQuillHTML(quill, html) {
  if (!quill) return;
  try {
    quill.clipboard.dangerouslyPasteHTML(html || '');
  } catch {
    quill.root.innerHTML = html || '';
  }
}
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
function setEditMode(edit) {
  isEditMode = edit;
  document.body.classList.toggle('edit-mode', edit);
  document.body.classList.toggle('view-mode', !edit);
  document.getElementById('profileActionsView').style.display = edit ? 'none' : 'flex';
  document.getElementById('profileActionsEdit').style.display = edit ? 'flex' : 'none';
  document.getElementById('chipsSection').style.display = edit ? 'none' : 'block';
}

function toggleEditMode() {
  if (!isEditMode) {
    // entrando a editar: no hay display cards en /perfil, los editores ya tienen el contenido guardado
  }
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

  // Chips: intereses / objetivos (solo visuales)
  renderChips('chipsIntereses', u.intereses || [], 'intereses');
  renderChips('chipsObjetivos', u.objetivos || [], 'objetivos');
  document.getElementById('chipsSection').style.display = (u.intereses?.length || u.objetivos?.length) ? 'block' : 'none';

  document.getElementById('profileHeading').textContent = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
  renderAvatar();
  const msg = document.getElementById('pfMsg');
  if (msg) { msg.textContent = ''; msg.className = 'profile-msg'; }

  // Iniciar en modo vista
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
    const u = window.tribuUser;
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
        intereses: u?.intereses || [],
        objetivos: u?.objetivos || [],
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
  } finally {
    hideLoader();
  }
})();