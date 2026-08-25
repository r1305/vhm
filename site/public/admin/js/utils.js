(function (global) {
  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-PE');
  }

  function formatDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('es-PE');
  }

  function fmtFechaShort(val) {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function badgeEstado(estado) {
    const map = {
      activo: 'background:#d1fae5;color:#065f46',
      prospecto: 'background:#dbeafe;color:#1d4ed8',
      alta: 'background:#ede9fe;color:#6d28d9',
      inactivo: 'background:#f3f4f6;color:#6b7280',
      lista_espera: 'background:#fef3c7;color:#92400e',
    };
    return map[estado] || 'background:#f3f4f6;color:#6b7280';
  }

  function showModal(id) {
    document.getElementById(id).classList.add('show');
  }

  function hideModal(id) {
    document.getElementById(id).classList.remove('show');
  }

  function bindModalClose(root) {
    (root || document).querySelectorAll('[data-modal-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-modal-close');
        if (id) hideModal(id);
      });
    });
    (root || document).querySelectorAll('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.classList.remove('show');
      });
    });
  }

  function bindTabs(containerSelector, panelPrefix) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    container.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tab = btn.getAttribute('data-tab');
        container.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('[data-panel]').forEach(function (p) {
          p.style.display = p.getAttribute('data-panel') === tab ? '' : 'none';
        });
        if (typeof global.onAdminTabChange === 'function') global.onAdminTabChange(tab);
      });
    });
  }

  function paginasVisibles(cp, tp) {
    const pages = [];
    for (let i = 1; i <= tp; i++) {
      if (i === 1 || i === tp || (i >= cp - 2 && i <= cp + 2)) pages.push(i);
      else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    return pages;
  }

  function mostrarMsg(el, texto, ok) {
    if (!el) return;
    el.textContent = texto;
    el.className = 'msg-box ' + (ok ? 'success' : 'error');
    el.style.display = texto ? 'block' : 'none';
  }

  global.AdminUtils = {
    formatDate, formatDateTime, fmtFechaShort, badgeEstado,
    showModal, hideModal, bindModalClose, bindTabs, paginasVisibles, mostrarMsg,
  };
})(window);
