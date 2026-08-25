(function (global) {
  let container;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  function toast(message, type, duration) {
    type = type || 'info';
    duration = duration == null ? 8000 : duration;
    const root = ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    el.innerHTML =
      '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span>' +
      '<span class="toast-msg">' + AdminApi.escapeHtml(message) + '</span>' +
      '<button type="button" class="toast-close" aria-label="Cerrar">×</button>';
    el.querySelector('.toast-close').onclick = function () { el.remove(); };
    root.appendChild(el);
    setTimeout(function () {
      el.classList.add('removing');
      setTimeout(function () { el.remove(); }, 300);
    }, duration);
  }

  global.toast = toast;
})(window);
