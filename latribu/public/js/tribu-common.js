/* tribu-common.js — auth, nav y helpers compartidos */

const API = (window.__APP_BASE__ || '') + '/api';
const BASE = window.__APP_BASE__ || '';

/* ── Loader global ── */
function showLoader(text) {
  const el = document.getElementById('pageLoader');
  const txt = document.getElementById('pageLoaderText');
  if (txt) txt.textContent = text || 'Cargando...';
  if (el) el.classList.add('show');
}
function hideLoader() {
  document.getElementById('pageLoader')?.classList.remove('show');
}

/* ── Storage ── */
function getToken() { return localStorage.getItem('tribu_token'); }
function setToken(t) { localStorage.setItem('tribu_token', t); }
function clearToken() { localStorage.removeItem('tribu_token'); localStorage.removeItem('tribu_user'); }
function getStoredUser() { try { return JSON.parse(localStorage.getItem('tribu_user') || 'null'); } catch { return null; } }
function setStoredUser(u) { localStorage.setItem('tribu_user', JSON.stringify(u)); }

/* ── Helpers ── */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function hoyYmdLocal() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}

function formatYmd(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function suscripcionVigente(sub) {
  if (!sub || !sub.fecha_fin) return false;
  return formatYmd(sub.fecha_fin) >= hoyYmdLocal();
}

function normalizarSuscripcionUsuario(user) {
  if (!user) return user;
  if (user.suscripcion_activa && !suscripcionVigente(user.suscripcion_activa))
    user.suscripcion_activa = null;
  return user;
}

function tieneSuscripcion() {
  return !!(window.tribuUser && suscripcionVigente(window.tribuUser.suscripcion_activa));
}

/* ── Fetch autenticado ── */
async function tribuFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  let body = options.body;
  if (body instanceof FormData) {
    delete headers['Content-Type'];
  } else if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return fetch(API + path, { ...options, headers, body });
}

/* ── Nav ── */
function renderNavAuth() {
  const area = document.getElementById('navAuthArea');
  if (!area) return;
  const user = window.tribuUser;
  if (user) {
    const initial = escapeHtml((user.nombre || '?').charAt(0).toUpperCase());
    const avatarHtml = user.foto_url
      ? `<img src="${escapeHtml(user.foto_url)}" class="user-menu-avatar" alt="">`
      : `<span class="user-menu-avatar-ph">${initial}</span>`;
    const fullName = escapeHtml(((user.nombre || '') + ' ' + (user.apellido || '')).trim() || 'Usuario');
    const p = window.location.pathname;
    area.innerHTML =
      `<div class="user-menu" id="userMenu">
        <button type="button" class="user-menu-btn" id="userMenuBtn" onclick="toggleUserMenu(event)" aria-expanded="false" aria-haspopup="true">
          ${avatarHtml}
          <span class="user-menu-label">
            <span class="user-menu-name">${escapeHtml(user.nombre || 'Usuario')}</span>
            <span class="user-menu-sub">Mi cuenta</span>
          </span>
          <span class="user-menu-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="user-menu-panel" id="userMenuPanel" role="menu">
          <div class="user-menu-head">
            <div class="user-menu-head-name">${fullName}</div>
            <div class="user-menu-head-email">${escapeHtml(user.email || '')}</div>
          </div>
          <a href="${BASE}/perfil" class="user-menu-item${p.endsWith('/perfil') ? ' active' : ''}" role="menuitem"><span class="mi">👤</span> Mi perfil</a>
          <a href="${BASE}/suscripciones" class="user-menu-item${p.endsWith('/suscripciones') ? ' active' : ''}" role="menuitem"><span class="mi">📋</span> Suscripciones</a>
          <a href="${BASE}/tarjetas" class="user-menu-item${p.endsWith('/tarjetas') ? ' active' : ''}" role="menuitem"><span class="mi">💳</span> Mis tarjetas</a>
          <div class="user-menu-divider"></div>
          <button type="button" class="user-menu-item danger" role="menuitem" onclick="doLogout()"><span class="mi">⎋</span> Cerrar sesión</button>
        </div>
      </div>`;
  } else {
    area.innerHTML = `<button type="button" class="nav-login-link" onclick="window.location.href='${BASE}/?login=1'">Iniciar sesión</button>`;
  }
}

function closeUserMenu() {
  const menu = document.getElementById('userMenu');
  const btn = document.getElementById('userMenuBtn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleUserMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('userMenu');
  const btn = document.getElementById('userMenuBtn');
  if (!menu || !btn) return;
  const open = !menu.classList.contains('open');
  closeUserMenu();
  if (open) { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
}

document.addEventListener('click', e => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) closeUserMenu();
});

/* ── Auth ── */
async function verificarSesion() {
  const token = getToken();
  if (!token) { window.tribuUser = null; renderNavAuth(); return false; }
  window.tribuUser = normalizarSuscripcionUsuario(getStoredUser());
  renderNavAuth();
  try {
    const res = await fetch(API + '/tribu-auth/me', { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
      window.tribuUser = normalizarSuscripcionUsuario(await res.json());
      setStoredUser(window.tribuUser);
    } else {
      clearToken(); window.tribuUser = null;
    }
  } catch {
    window.tribuUser = normalizarSuscripcionUsuario(getStoredUser());
  }
  renderNavAuth();
  return !!window.tribuUser;
}

function requireAuth() {
  if (!getToken()) { window.location.href = BASE + '/?login=1'; return false; }
  return true;
}

function doLogout() {
  clearToken();
  window.tribuUser = null;
  window.location.href = BASE + '/';
}

/* ── Modals compartidos ── */
function mostrarTribuFeedback({ type = 'success', title, message, btnText = 'Continuar', hideButton = false, onClose = null }) {
  const overlay = document.getElementById('tribuFeedbackOverlay');
  const icon = document.getElementById('tribuFeedbackIcon');
  const btn = document.getElementById('tribuFeedbackBtn');
  if (!overlay) return;
  window._tribuFeedbackOnClose = typeof onClose === 'function' ? onClose : null;
  icon.className = 'tribu-feedback-icon ' + type;
  if (type === 'processing') icon.innerHTML = '<span class="tribu-feedback-spinner"></span>';
  else if (type === 'error') icon.textContent = '✕';
  else if (type === 'warn') icon.textContent = '!';
  else if (type === 'pending') icon.textContent = '⏳';
  else icon.textContent = '✓';
  document.getElementById('tribuFeedbackTitle').textContent = title;
  document.getElementById('tribuFeedbackMsg').textContent = message;
  if (btn) { btn.textContent = btnText; btn.style.display = hideButton ? 'none' : ''; }
  overlay.classList.toggle('no-dismiss', type === 'processing');
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
  if (!hideButton && btn) setTimeout(() => btn.focus(), 80);
}

function cerrarTribuFeedback() {
  const overlay = document.getElementById('tribuFeedbackOverlay');
  if (!overlay) return;
  overlay.classList.remove('show', 'no-dismiss');
  if (!document.getElementById('tribuConfirmOverlay')?.classList.contains('show'))
    document.body.style.overflow = '';
  const onClose = window._tribuFeedbackOnClose;
  window._tribuFeedbackOnClose = null;
  if (typeof onClose === 'function') onClose();
}

function mostrarTribuConfirm({ title, message, confirmText = 'Confirmar', cancelText = 'Volver', danger = true }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('tribuConfirmOverlay');
    const okBtn = document.getElementById('tribuConfirmOk');
    const cancelBtn = document.getElementById('tribuConfirmCancel');
    if (!overlay || !okBtn || !cancelBtn) { resolve(false); return; }
    document.getElementById('tribuConfirmTitle').textContent = title || '¿Confirmar acción?';
    document.getElementById('tribuConfirmMsg').textContent = message || '';
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.className = 'tribu-confirm-btn ' + (danger ? 'danger' : 'primary');
    window._tribuConfirmResolve = resolve;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => cancelBtn.focus(), 80);
  });
}

function cerrarTribuConfirm(result) {
  const overlay = document.getElementById('tribuConfirmOverlay');
  if (overlay) overlay.classList.remove('show');
  if (!document.getElementById('tribuFeedbackOverlay')?.classList.contains('show'))
    document.body.style.overflow = '';
  const resolve = window._tribuConfirmResolve;
  window._tribuConfirmResolve = null;
  if (typeof resolve === 'function') resolve(!!result);
}
