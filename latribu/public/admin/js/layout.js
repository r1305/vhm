(function (global) {
  const NAV_META = {
    videos:       { href: 'videos.html',      icon: '🎬', label: 'La Tribu',        section: 'principal' },
    'tribu-users':{ href: 'tribu-users.html', icon: '🫂', label: 'Usuarios Tribu',  section: 'principal' },
    plantillas:   { href: 'plantillas.html',  icon: '📝', label: 'Plantillas',       section: 'principal' },
    encuestas:    { href: 'encuestas.html',   icon: '📊', label: 'Encuestas',        section: 'principal' },
    testimonios:  { href: 'testimonios.html', icon: '⭐', label: 'Testimonios',      section: 'principal' },
    posts:        { href: 'posts.html',       icon: '💜', label: 'Comunidad',       section: 'principal' },
    contenido:    { href: 'contenido.html',   icon: '📄', label: 'Contenido',       section: 'principal' },
    usuarios:     { href: 'usuarios.html',    icon: '👥', label: 'Administradores',  section: 'config' },
    config:       { href: 'config.html',      icon: '⚙️', label: 'Ajustes',          section: 'config' },
    accesos:      { href: 'accesos.html',     icon: '🔐', label: 'Accesos',          section: 'config' },
  };

  const NAV_ORDER = ['videos', 'tribu-users', 'plantillas', 'encuestas', 'testimonios', 'posts', 'contenido', 'usuarios', 'config', 'accesos'];

  function logoSrc() { return AdminApi.asset('logo_latribu.png') + '?' + Date.now(); }

  function canSee(itemId) { return AdminAuth.hasAccess(itemId); }

  /**
   * Devuelve la pagina a la que puede ir el usuario, o null si no tiene ninguna.
   *
   * Antes caia en 'videos.html' como valor por defecto. Eso provocaba un bucle
   * infinito: un usuario sin ningun permiso-era redireigido a videos.html, esa
   * pagina comprobaba el permiso de 'videos', no lo tenia, y volvia a pedir
   * firstAllowedHref(), que devolvia 'videos.html' otra vez. Sin mas.
   */
  function firstAllowedHref() {
    for (let i = 0; i < NAV_ORDER.length; i++) {
      const id = NAV_ORDER[i];
      if (canSee(id) && NAV_META[id]) return NAV_META[id].href;
    }
    return null;
  }

  /**
   * Redirige fuera de la pagina actual. Si el destino es la propia pagina se
   * corta la redireccion, porque repetirla no lleva a ninguna parte.
   */
  function irA(target) {
    if (!target) return false;
    const actual = global.location.pathname.split('/').pop();
    if (target === actual || target === global.location.href) return false;
    global.location.href = target;
    return true;
  }

  function sinPermisos() {
    const main = document.getElementById('page-main');
    if (!main) return;
    main.innerHTML =
      '<div style="text-align:center;padding:64px 24px;max-width:420px;margin:0 auto">' +
        '<div style="font-size:3rem">🔒</div>' +
        '<h2 style="margin:12px 0 8px">Sin permisos asignados</h2>' +
        '<p style="color:var(--text-secondary);margin:0 0 24px">' +
          'Tu cuenta no tiene ninguna seccion habilitada. Pide a un Super Admin que te asigne accesos.</p>' +
        '<button type="button" class="btn btn-primary" id="btn-salir">Cerrar sesion</button>' +
      '</div>';
    main.style.display = '';
    const btn = document.getElementById('btn-salir');
    if (btn) btn.addEventListener('click', AdminAuth.logout);
  }

  async function init(options) {
    options = options || {};
    AdminAuth.loadTheme();
    if (options.public) return true;
    if (!AdminAuth.requireAuth()) return false;
    await AdminAuth.ensureMenuItems();

    if (options.requireSuperAdmin && !AdminAuth.isSuperAdmin()) {
      if (!irA(firstAllowedHref())) sinPermisos();
      return false;
    }
    const page = options.page || '';
    if (page && !AdminAuth.hasAccess(page)) {
      if (!irA(firstAllowedHref())) sinPermisos();
      return false;
    }

    const user = AdminAuth.state.user || {};
    const initial = (user.nombre || user.username || 'A').charAt(0).toUpperCase();
    const rolLabel = user.rol === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrador';
    const title = options.title || 'Panel';

    const navPrincipal = NAV_ORDER.filter(id => NAV_META[id] && NAV_META[id].section === 'principal');
    const navConfig = NAV_ORDER.filter(id => NAV_META[id] && NAV_META[id].section === 'config');

    function navHtml(items) {
      return items.filter(canSee).map(function (id) {
        const item = NAV_META[id];
        const active = id === page ? ' active' : '';
        return '<button type="button" class="nav-item' + active + '" data-href="' + item.href + '">' +
          '<span class="nav-icon">' + item.icon + '</span> ' + AdminApi.escapeHtml(item.label) + '</button>';
      }).join('');
    }

    const root = document.getElementById('admin-root');
    const main = document.getElementById('page-main');
    if (!root || !main) return false;

    root.innerHTML =
      '<div class="sidebar-overlay" id="sidebar-overlay"></div>' +
      '<aside class="sidebar" id="sidebar">' +
        '<div class="sidebar-brand">' +
          '<div class="brand-text"><div class="brand-title">La Tribu Admin</div><div class="brand-sub">Panel de gestión</div></div>' +
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
      btn.addEventListener('click', function () { global.location.href = btn.getAttribute('data-href'); });
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

    return true;
  }

  global.AdminLayout = { init, logoSrc, firstAllowedHref, NAV_META };
})(window);
