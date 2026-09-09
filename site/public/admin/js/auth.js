(function (global) {
  const state = {
    get token() { return localStorage.getItem('token'); },
    get user() {
      try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
    },
    get theme() { return localStorage.getItem('theme') || 'light'; },
  };

  function isSuperAdmin() {
    return state.user && state.user.rol === 'SUPER_ADMIN';
  }

  function isAdmin() {
    const r = state.user && state.user.rol;
    return r === 'SUPER_ADMIN' || r === 'ADMIN';
  }

  function getMenuItems() {
    if (isSuperAdmin()) return null;
    const u = state.user;
    return (u && Array.isArray(u.menuItems)) ? u.menuItems : [];
  }

  function hasAccess(pageId) {
    if (!pageId) return true;
    if (isSuperAdmin()) return true;
    const items = getMenuItems();
    return items.includes(pageId);
  }

  async function ensureMenuItems() {
    if (!state.token) return [];
    if (isSuperAdmin()) return [];
    try {
      const res = await fetch(AdminApi.API_BASE + '/accesos/mi-menu', {
        credentials: 'same-origin',
        headers: AdminApi.authHeaders(),
      });
      if (!res.ok) return getMenuItems();
      const data = await res.json();
      const items = data.items || [];
      const u = state.user;
      if (u) {
        u.menuItems = items;
        localStorage.setItem('user', JSON.stringify(u));
      }
      return items;
    } catch (_) {
      return getMenuItems();
    }
  }

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }

  function loadTheme() {
    applyTheme(state.theme === 'dark');
  }

  function toggleTheme() {
    applyTheme(state.theme !== 'dark');
  }

  async function login(username, password) {
    const res = await fetch(AdminApi.API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    let data;
    try { data = await res.json(); } catch {
      throw new Error('Error del servidor. Verifica que el servidor esté activo.');
    }
    if (!res.ok) throw new Error(data.error || 'Usuario o contraseña incorrectos');
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    global.location.href = 'login.html';
  }

  function requireAuth() {
    if (!state.token) {
      global.location.href = 'login.html';
      return false;
    }
    return true;
  }

  function requireSuperAdmin() {
    if (!requireAuth()) return false;
    if (!isSuperAdmin()) {
      global.location.href = 'reclamos.html';
      return false;
    }
    return true;
  }

  global.AdminAuth = {
    state, isSuperAdmin, isAdmin, getMenuItems, hasAccess, ensureMenuItems,
    login, logout, loadTheme, toggleTheme, requireAuth, requireSuperAdmin,
  };
})(window);
