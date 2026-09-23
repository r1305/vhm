/* perfil.js */

let quillHobbies = null;
let quillDedicas = null;
const EMOJIS = ['😊','😂','🥰','😎','🤩','🙌','💪','🎉','🔥','✨','💡','🎯','🌟','🚀','💼','📚','🎨','🎵','🏋️','🧘','🌿','🍀','🐾','✈️','🌍','🏠','❤️','💙','💚','💛','🧡','💜','🤝','👏','🙏','💬','📝','🎓','🏆','⭐'];

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

function renderProfileAvatar() {
  const wrap = document.getElementById('profileAvatarWrap');
  if (!wrap || !window.tribuUser) return;
  const initial = escapeHtml((window.tribuUser.nombre || '?').charAt(0).toUpperCase());
  wrap.innerHTML = window.tribuUser.foto_url
    ? `<img src="${escapeHtml(window.tribuUser.foto_url)}" class="profile-avatar" alt="Foto de perfil">`
    : `<div class="profile-avatar profile-avatar-ph">${initial}</div>`;
  const rm = document.getElementById('pfRemoveFotoBtn');
  if (rm) rm.style.display = window.tribuUser.foto_url ? '' : 'none';
}

function fillPerfilForm() {
  const u = window.tribuUser;
  if (!u) return;
  document.getElementById('pfNombre').value = u.nombre || '';
  document.getElementById('pfApellido').value = u.apellido || '';
  document.getElementById('pfEmail').value = u.email || '';
  document.getElementById('pfTelefono').value = u.telefono || '';
  document.getElementById('pfCarrera').value = u.carrera || '';
  if (quillHobbies) quillHobbies.root.innerHTML = u.hobbies || '';
  if (quillDedicas) quillDedicas.root.innerHTML = u.a_que_te_dedicas || '';
  document.getElementById('profileHeading').textContent = ((u.nombre || '') + ' ' + (u.apellido || '')).trim();
  renderProfileAvatar();
  const msg = document.getElementById('pfMsg');
  if (msg) { msg.textContent = ''; msg.className = 'profile-msg'; }
}

function setProfileMsg(text, ok) {
  const el = document.getElementById('pfMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'profile-msg ' + (ok ? 'ok' : 'err');
}

async function guardarPerfil() {
  const btn = document.getElementById('pfSaveBtn');
  btn.disabled = true;
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
  }
}

async function subirFotoPerfil() {
  const input = document.getElementById('pfFoto');
  if (!input?.files?.length) { setProfileMsg('Selecciona una imagen primero', false); return; }
  const fd = new FormData();
  fd.append('foto', input.files[0]);
  try {
    const res = await tribuFetch('/tribu-auth/perfil/foto', { method: 'POST', body: fd });
    const d = await res.json();
    if (!res.ok) { setProfileMsg(d.error || 'Error al subir foto', false); return; }
    window.tribuUser = normalizarSuscripcionUsuario(d.user);
    setStoredUser(window.tribuUser);
    input.value = '';
    renderNavAuth();
    fillPerfilForm();
    setProfileMsg('Foto actualizada', true);
  } catch {
    setProfileMsg('Error de conexión', false);
  }
}

async function quitarFotoPerfil() {
  if (!confirm('¿Quitar tu foto de perfil?')) return;
  try {
    const res = await tribuFetch('/tribu-auth/perfil/foto', { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { setProfileMsg(d.error || 'Error', false); return; }
    window.tribuUser = normalizarSuscripcionUsuario(d.user);
    setStoredUser(window.tribuUser);
    renderNavAuth();
    fillPerfilForm();
    setProfileMsg('Foto eliminada', true);
  } catch {
    setProfileMsg('Error de conexión', false);
  }
}

/* ── Init ── */
(async () => {
  if (!requireAuth()) return;
  const ok = await verificarSesion();
  if (!ok) { window.location.href = BASE + '/?login=1'; return; }
  initQuillEditors();
  fillPerfilForm();
  try {
    const res = await tribuFetch('/tribu-auth/me');
    if (res.ok) {
      window.tribuUser = normalizarSuscripcionUsuario(await res.json());
      setStoredUser(window.tribuUser);
      fillPerfilForm();
      renderNavAuth();
    }
  } catch {}
})();
