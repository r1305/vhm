/* ═══════════════════════════════════════════════════════
   VHM CRM — app.js  Parte 1: Core, Auth, Nav, Utils
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Constantes ──────────────────────────────────── */
  const BASE = window.__APP_BASE__ || '';
  const API  = `${BASE}/api`;

  const ESTADO_PACIENTE = {
    activo: { label: 'Activo',       css: 'badge-green'  },
    prospecto: { label: 'Prospecto', css: 'badge-yellow' },
    confirmado: { label: 'Confirmado', css: 'badge-blue' },
    alta: { label: 'Alta',           css: 'badge-blue'   },
    inactivo: { label: 'Inactivo',   css: 'badge-gray'   },
    lista_espera: { label: 'Espera', css: 'badge-purple' },
  };

  const ESTADO_LEAD = {
    nuevo:      { label: 'Nuevo',      css: 'badge-purple' },
    contactado: { label: 'Contactado', css: 'badge-yellow' },
    agendado:   { label: 'Agendado',   css: 'badge-blue'   },
    convertido: { label: 'Convertido', css: 'badge-green'  },
    descartado: { label: 'Descartado', css: 'badge-gray'   },
  };

  const FUENTE_ICON = {
    instagram: 'fa-brands fa-instagram',
    tiktok:    'fa-brands fa-tiktok',
    web:       'fas fa-globe',
    whatsapp:  'fa-brands fa-whatsapp',
    referido:  'fas fa-user-plus',
    otro:      'fas fa-circle-dot',
  };

  const ESTADO_CITA = {
    pendiente:  { label: 'Pendiente',  css: 'badge-yellow' },
    confirmada: { label: 'Confirmada', css: 'badge-blue'   },
    realizada:  { label: 'Realizada',  css: 'badge-green'  },
    cancelada:  { label: 'Cancelada',  css: 'badge-red'    },
    no_show:    { label: 'No se presentó', css: 'badge-gray' },
  };

  /* ── Token / sesión ──────────────────────────────── */
  let _token = localStorage.getItem('crm_token') || '';
  let _user  = null;

  function getToken()    { return _token; }
  function setToken(t)   { _token = t; localStorage.setItem('crm_token', t); }
  function clearToken()  { _token = ''; localStorage.removeItem('crm_token'); }

  /* ── API helper ──────────────────────────────────── */
  async function api(path, opts = {}) {
    const url = `${API}${path.startsWith('/') ? path : '/' + path}`;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (_token) headers.Authorization = `Bearer ${_token}`;

    const res = await fetch(url, {
      ...opts,
      headers,
      body: opts.body && typeof opts.body === 'object' ? JSON.stringify(opts.body) : opts.body,
    });

    if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
    return data;
  }

  /* ── Toast ───────────────────────────────────────── */
  function toast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', danger: 'fa-circle-exclamation', info: 'fa-circle-info' };
    el.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i> ${esc(msg)}`;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  /* ── Escape HTML ─────────────────────────────────── */
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  /* ── Formato ─────────────────────────────────────── */
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtMoney(v) {
    return 'S/ ' + (parseFloat(v) || 0).toFixed(2);
  }

  function badge(estado, map) {
    const e = map[estado] || { label: estado, css: 'badge-gray' };
    return `<span class="badge ${e.css}">${esc(e.label)}</span>`;
  }

  function fullName(p) {
    return `${p.nombre || ''} ${p.apellido || ''}`.trim();
  }

  function isAdmin() {
    const rol = _user?.rol;
    return rol === 'superadmin' || rol === 'recepcion';
  }

  /* ── Modal ───────────────────────────────────────── */
  let _modalSave = null;

  function openModal(title, html, onSave, { large = false } = {}) {
    document.getElementById('modalSave').style.display = '';
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = html;
    const modal = document.getElementById('modal');
    modal.classList.toggle('lg', large);
    _modalSave = onSave;
    document.getElementById('modalOverlay').classList.add('open');
    // focus primer input
    setTimeout(() => modal.querySelector('input,select,textarea')?.focus(), 80);
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    _modalSave = null;
  }

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modalSave').addEventListener('click', async () => {
    if (!_modalSave) return;
    const btnSave   = document.getElementById('modalSave');
    const btnCancel = document.getElementById('modalCancel');
    const btnClose  = document.getElementById('modalClose');
    const body      = document.getElementById('modalBody');
    const inputs    = body.querySelectorAll('input,select,textarea,button');

    btnSave.disabled   = true;
    btnCancel.disabled = true;
    btnClose.disabled  = true;
    btnSave.innerHTML  = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    inputs.forEach(el => { el.disabled = true; });

    try {
      await _modalSave();
      closeModal();
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      btnSave.disabled   = false;
      btnCancel.disabled = false;
      btnClose.disabled  = false;
      btnSave.innerHTML  = 'Guardar';
      inputs.forEach(el => { el.disabled = false; });
    }
  });

  /* ── Tema ────────────────────────────────────────── */
  const themeBtn = document.getElementById('themeBtn');
  function updateThemeIcon() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.innerHTML = `<i class="fas ${dark ? 'fa-sun' : 'fa-moon'}"></i>`;
  }
  updateThemeIcon();
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('crm-theme', next);
    updateThemeIcon();
  });

  /* ── Sidebar mobile ──────────────────────────────── */
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  function checkMobile() {
    const isMobile = window.innerWidth < 769;
    sidebarToggle.style.display = isMobile ? 'flex' : 'none';
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);
  sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

  /* ── Navegación ──────────────────────────────────── */
  const viewTitles = {
    dashboard:       'Dashboard',
    agenda:          'Agenda',
    pacientes:       'Pacientes',
    leads:           'Leads',
    historial:       'Historial clínico',
    consentimientos: 'Consentimientos',
    pagos:           'Pagos',
    espera:          'Lista de espera',
    marketing:       'Email Marketing',
    asignacion:      'Asignación automática',
    integraciones:   'Integraciones',
    analitica:       'Analítica web',
    terapeutas:      'Terapeutas',
    reportes:        'Reportes',
  };

  // ==================== ROUTER (Hash-based) ====================
  const ROUTE_VIEWS = {
    '': 'dashboard',           // default
    'dashboard': 'dashboard',
    'agenda': 'agenda',
    'pacientes': 'pacientes',
    'leads': 'leads',
    'historial': 'historial',
    'consentimientos': 'consentimientos',
    'pagos': 'pagos',
    'espera': 'espera',
    'marketing': 'marketing',
    'asignacion': 'asignacion',
    'integraciones': 'integraciones',
    'analitica': 'analitica',
    'terapeutas': 'terapeutas',
    'reportes': 'reportes',
  };

  // Vistas que requieren permisos de admin (superadmin o recepcion)
  const ADMIN_ONLY_VIEWS = ['marketing', 'asignacion', 'integraciones', 'analitica', 'terapeutas', 'reportes'];
  const TERAPEUTA_ONLY_VIEWS = ['agenda', 'pacientes', 'historial'];

  function navigateTo(view) {
    if (ADMIN_ONLY_VIEWS.includes(view) && !isAdmin()) {
      toast('No tienes permisos para acceder a esta sección', 'danger');
      return false;
    }
    const user = _user;
    if (user?.rol === 'terapeuta' && !TERAPEUTA_ONLY_VIEWS.includes(view)) {
      toast('No tienes permisos para acceder a esta sección', 'danger');
      return false;
    }

    const hash = `#${view}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    return true;
  }

  function handleHashChange() {
    if (!_user) return;
    const hash = window.location.hash.slice(1);
    const view = ROUTE_VIEWS[hash] || (_user.rol === 'terapeuta' ? 'agenda' : 'dashboard');

    if (ADMIN_ONLY_VIEWS.includes(view) && !isAdmin()) {
      window.location.hash = _user.rol === 'terapeuta' ? '#agenda' : '#dashboard';
      return;
    }
    if (_user.rol === 'terapeuta' && !TERAPEUTA_ONLY_VIEWS.includes(view)) {
      window.location.hash = '#agenda';
      return;
    }

    switchView(view, false);
  }

  function initRouter() {
    // Escuchar cambios de hash
    window.addEventListener('hashchange', handleHashChange);

    // Manejar hash inicial al cargar
    handleHashChange();
  }

  const viewLoaders = {};   // registrados por cada módulo

  function switchView(name, updateHash = true) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const panel = document.getElementById(`view-${name}`);
    if (panel) panel.classList.add('active');
    const navBtn = document.querySelector(`.nav-item[data-view="${name}"]`);
    if (navBtn) navBtn.classList.add('active');
    document.getElementById('pageTitle').textContent = viewTitles[name] || name;
    sidebar.classList.remove('open');
    viewLoaders[name]?.();
  }

  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  /* ── Login ───────────────────────────────────────── */
  async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('loginError');
    errEl.style.display = 'none';
    if (!username || !password) { errEl.textContent = 'Ingresa tu usuario y contraseña'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ingresando…';
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password } });
      setToken(data.token);
      _user = data.user;
      showApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Ingresar';
    }
  }

  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('loginUsername').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  /* ── Logout ──────────────────────────────────────── */
  function logout() {
    clearToken(); _user = null;
    history.replaceState(null, '', window.location.pathname);
    document.getElementById('appPage').style.display = 'none';
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('loginPassword').value = '';
  }
  document.getElementById('logoutBtn').addEventListener('click', logout);

  /* ── showApp ─────────────────────────────────────── */
  function showApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appPage').style.display = 'flex';
    const initials = `${_user.nombre?.[0] || ''}${_user.apellido?.[0] || ''}`.toUpperCase();
    document.getElementById('userAvatar').textContent = initials || '?';
    document.getElementById('userName').textContent   = fullName(_user);
    document.getElementById('userRole').textContent   = _user.rol;
    const isTerapeuta = _user.rol === 'terapeuta';
    const isAdminUser = ['superadmin', 'recepcion'].includes(_user.rol);
    document.querySelectorAll('.nav-admin').forEach(el => {
      el.style.display = isAdminUser ? 'flex' : 'none';
    });
    document.querySelectorAll('.nav-no-terapeuta').forEach(el => {
      el.style.display = isTerapeuta ? 'none' : '';
    });
    initRouter();
    if (isTerapeuta && !window.location.hash.includes('agenda') &&
        !window.location.hash.includes('pacientes') && !window.location.hash.includes('historial')) {
      window.location.hash = '#agenda';
    }
  }

  /* ── Auto-login si hay token ─────────────────────── */
  (async function init() {
    if (!_token) return;
    try {
      const user = await api('/auth/me');
      _user = user;
      showApp();
    } catch { clearToken(); }
  })();

  /* ── Exponer globals para los demás módulos ──────── */
  // Loading state helper
  function showLoading(el, loading) {
    if (!el) return;
    if (loading) {
      el.dataset.prevHtml = el.innerHTML;
      el.innerHTML = '<div class="view-loading">Cargando…</div>';
    } else if (el.dataset.prevHtml !== undefined) {
      el.innerHTML = el.dataset.prevHtml;
      delete el.dataset.prevHtml;
    }
  }

  window.CRM = {
    api, toast, esc, fmtDate, fmtMoney, badge, fullName, openModal, closeModal,
    switchView, viewLoaders, navigateTo, showLoading,
    ESTADO_PACIENTE, ESTADO_LEAD, FUENTE_ICON, ESTADO_CITA,
    getUser: () => _user,
    isAdmin: () => ['superadmin', 'recepcion'].includes(_user?.rol),
  };

})();
