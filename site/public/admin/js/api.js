(function (global) {
  const base = (global.__APP_BASE__ || '').replace(/\/+$/, '');
  const API_BASE = (base && !global.location.pathname.startsWith(base + '/') && global.location.pathname !== base)
    ? '/api'
    : (base || '') + '/api';

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function authHeaders() {
    const token = localStorage.getItem('token');
    const csrf = getCookie('csrf_token') || '';
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'X-CSRF-Token': csrf,
    };
  }

  function formHeaders() {
    const token = localStorage.getItem('token');
    const csrf = getCookie('csrf_token') || '';
    return {
      Authorization: 'Bearer ' + token,
      'X-CSRF-Token': csrf,
    };
  }

  async function apiFetch(url, options) {
    const res = await fetch(API_BASE + url, options || {});
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      global.location.href = 'login.html';
      throw new Error('Sesión expirada');
    }
    return res;
  }

  function apiUrl(path) {
    return API_BASE + path;
  }

  function asset(path) {
    const b = base || '';
    return (b ? b + '/' : '/') + String(path || '').replace(/^\//, '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  global.AdminApi = { API_BASE, getCookie, authHeaders, formHeaders, apiFetch, apiUrl, asset, escapeHtml };
})(window);
