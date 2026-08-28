/* ═══════════════════════════════════════════════════════
   VHM CRM — app.js  Utilidades compartidas (MPA)
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const BASE = window.__APP_BASE__ || '';
  const API  = `${BASE}/api`;

  /* ── Constantes ──────────────────────────────────── */
  const ESTADO_PACIENTE = {
    activo:       { label: 'Activo',       css: 'badge-green'  },
    prospecto:    { label: 'Prospecto',    css: 'badge-yellow' },
    confirmado:   { label: 'Confirmado',   css: 'badge-blue'   },
    alta:         { label: 'Alta',         css: 'badge-blue'   },
    inactivo:     { label: 'Inactivo',     css: 'badge-gray'   },
    lista_espera: { label: 'Espera',       css: 'badge-purple' },
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
    pendiente:  { label: 'Pendiente',      css: 'badge-yellow' },
    confirmada: { label: 'Confirmada',     css: 'badge-blue'   },
    reagendada: { label: 'Reagendada',     css: 'badge-purple' },
    realizada:  { label: 'Realizada',      css: 'badge-green'  },
    cancelada:  { label: 'Cancelada',      css: 'badge-red'    },
    no_show:    { label: 'No se presentó', css: 'badge-gray'   },
  };

  const ESTADO_CITA_SELECT_EXCLUDE = new Set(['confirmada']);

  function estadoCitaSelectEntries() {
    return Object.entries(ESTADO_CITA).filter(([k]) => !ESTADO_CITA_SELECT_EXCLUDE.has(k));
  }

  /** Opciones HTML para selects de estado de cita (sin Confirmada). */
  function estadoCitaOptionsHtml(selected = null) {
    const sel = ESTADO_CITA_SELECT_EXCLUDE.has(selected) ? 'pendiente' : selected;
    return estadoCitaSelectEntries()
      .map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v.label}</option>`)
      .join('');
  }

  /* ── API helper (usa cookie de sesión automáticamente) ── */
  async function api(path, opts = {}) {
    const url = `${API}${path.startsWith('/') ? path : '/' + path}`;
    const res = await fetch(url, {
      ...opts,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: opts.body && typeof opts.body === 'object' ? JSON.stringify(opts.body) : opts.body,
    });
    if (res.status === 401) { window.location.href = `${BASE}/login`; throw new Error('Sesión expirada'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
    return data;
  }

  /* ── Toast ───────────────────────────────────────── */
  function toast(msg, type = 'success') {
    const c  = document.getElementById('toastContainer');
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

  /* ── Modal ───────────────────────────────────────── */
  let _modalSave = null;

  function openModal(title, html, onSave, { large = false, saveLabel = 'Guardar', saveClass = 'btn btn-primary' } = {}) {
    const btnSave = document.getElementById('modalSave');
    btnSave.style.display = onSave ? '' : 'none';
    btnSave.className = saveClass;
    btnSave.textContent = saveLabel;
    document.getElementById('modalTitle').textContent  = title;
    document.getElementById('modalBody').innerHTML     = html;
    const modal = document.getElementById('modal');
    modal.classList.toggle('lg', large);
    _modalSave = onSave;
    document.getElementById('modalOverlay').classList.add('open');
    setTimeout(() => modal.querySelector('input,select,textarea')?.focus(), 80);
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    _modalSave = null;
  }

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modalSave').addEventListener('click', async () => {
    if (!_modalSave) return;
    const btnSave   = document.getElementById('modalSave');
    const btnCancel = document.getElementById('modalCancel');
    const btnClose  = document.getElementById('modalClose');
    const inputs    = document.getElementById('modalBody').querySelectorAll('input,select,textarea,button');
    btnSave.disabled = btnCancel.disabled = btnClose.disabled = true;
    btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    inputs.forEach(el => el.disabled = true);
    try {
      await _modalSave();
      closeModal();
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      btnSave.disabled = btnCancel.disabled = btnClose.disabled = false;
      btnSave.className = 'btn btn-primary';
      btnSave.textContent = 'Guardar';
      inputs.forEach(el => el.disabled = false);
    }
  });

  /* ── Exponer globals (antes de listeners para que módulos siempre tengan acceso) ── */
  window.CRM = {
    api, toast, esc, fmtDate, fmtMoney, badge, fullName,
    openModal, closeModal,
    ESTADO_PACIENTE, ESTADO_LEAD, FUENTE_ICON, ESTADO_CITA,
    estadoCitaOptionsHtml, estadoCitaSelectEntries,
    pacientesCache: [],
  };

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
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const sidebar       = document.getElementById('sidebar');

  function closeSidebar() {
    sidebar?.classList.remove('open');
    sidebarBackdrop?.classList.remove('open');
  }

  function openSidebar() {
    sidebar?.classList.add('open');
    sidebarBackdrop?.classList.add('open');
  }

  sidebarToggle?.addEventListener('click', () => {
    if (sidebar?.classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  sidebarBackdrop?.addEventListener('click', closeSidebar);
  sidebar?.querySelectorAll('.nav-item').forEach(link =>
    link.addEventListener('click', closeSidebar)
  );
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 769) closeSidebar();
  });

})();
