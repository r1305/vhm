(function (global) {
  const NAV = [
    { id: 'reclamos', href: 'reclamos.html', icon: '📋', label: 'Reclamos', roles: 'all' },
    { id: 'testimonios', href: 'testimonios.html', icon: '⭐', label: 'Testimonios', roles: 'admin' },
    { id: 'videos', href: 'videos.html', icon: '🎬', label: 'La Tribu', roles: 'all' },
    { id: 'tribu-users', href: 'tribu-users.html', icon: '🫂', label: 'Usuarios Tribu', roles: 'all' },
    { id: 'usuarios', href: 'usuarios.html', icon: '👥', label: 'Administradores', roles: 'all' },
    { id: 'config', href: 'config.html', icon: '⚙️', label: 'Ajustes', roles: 'admin', superOnlyRoute: true },
  ];

  function logoSrc() {
    return AdminApi.asset('logo_vhm.jpeg');
  }

  function canSee(item) {
    if (item.id === 'config' && !AdminAuth.isSuperAdmin()) return false;
    if (item.roles === 'admin') return AdminAuth.isAdmin();
    return true;
  }

  function init(options) {
    options = options || {};
    AdminAuth.loadTheme();

    if (options.public) return;

    if (options.requireSuperAdmin) {
      if (!AdminAuth.requireSuperAdmin()) return;
    } else if (!AdminAuth.requireAuth()) {
      return;
    }

    const user = AdminAuth.state.user || {};
    const initial = (user.nombre || user.username || 'A').charAt(0).toUpperCase();
    const rolLabel = user.rol === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrador';
    const page = options.page || '';
    const title = options.title || 'Panel';

    const navPrincipal = NAV.filter(function (n) { return n.id !== 'usuarios' && n.id !== 'config'; });
    const navConfig = NAV.filter(function (n) { return n.id === 'usuarios' || n.id === 'config'; });

    function navHtml(items) {
      return items.filter(canSee).map(function (item) {
        const active = item.id === page ? ' active' : '';
        return '<button type="button" class="nav-item' + active + '" data-href="' + item.href + '">' +
          '<span class="nav-icon">' + item.icon + '</span> ' + AdminApi.escapeHtml(item.label) + '</button>';
      }).join('');
    }

    const root = document.getElementById('admin-root');
    const main = document.getElementById('page-main');
    if (!root || !main) return;

    root.innerHTML =
      '<div class="sidebar-overlay" id="sidebar-overlay"></div>' +
      '<aside class="sidebar" id="sidebar">' +
        '<div class="sidebar-brand">' +
          '<img src="' + logoSrc() + '" alt="VHM">' +
          '<div class="brand-text"><div class="brand-title">VHM Admin</div><div class="brand-sub">Panel de gestión</div></div>' +
        '</div>' +
        '<nav class="sidebar-nav">' +
          '<div class="nav-label">Principal</div>' + navHtml(navPrincipal) +
          '<div class="nav-label">Configuración</div>' + navHtml(navConfig) +
        '</nav>' +
        '<div class="sidebar-footer">' +
          '<div class="user-card"><div class="user-avatar">' + AdminApi.escapeHtml(initial) + '</div>' +
            '<div><div class="user-name">' + AdminApi.escapeHtml(user.nombre || user.username || 'Usuario') + '</div>' +
            '<div class="user-rol">' + rolLabel + '</div></div></div>' +
          '<button type="button" class="btn-theme" id="btn-theme" style="width:100%;padding:10px;margin-bottom:6px;border:1px solid var(--border-strong);background:var(--bg-card);border-radius:10px;font-size:.85rem;color:var(--text-secondary);font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">' +
            (AdminAuth.state.theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro') + '</button>' +
          '<button type="button" class="btn-logout" id="btn-logout"><span>🚪</span> Cerrar sesión</button>' +
        '</div>' +
      '</aside>' +
      '<div class="main-wrapper">' +
        '<div class="topbar">' +
          '<button type="button" class="hamburger" id="btn-hamburger">☰</button>' +
          '<div class="page-title">' + AdminApi.escapeHtml(title) + '</div>' +
        '</div>' +
        '<div class="content" id="admin-content"></div>' +
      '</div>';

    document.getElementById('admin-content').appendChild(main);
    main.style.display = '';

    document.querySelectorAll('.nav-item[data-href]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        global.location.href = btn.getAttribute('data-href');
      });
    });

    document.getElementById('btn-logout').addEventListener('click', AdminAuth.logout);
    document.getElementById('btn-theme').addEventListener('click', function () {
      AdminAuth.toggleTheme();
      this.innerHTML = AdminAuth.state.theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro';
    });

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    document.getElementById('btn-hamburger').addEventListener('click', function () {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    });
    overlay.addEventListener('click', function () {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }

  global.AdminLayout = { init, logoSrc };
})(window);
