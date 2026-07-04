const base = (window.__APP_BASE__ || '').replace(/\/+$/, '')
const API_BASE = (base && !window.location.pathname.startsWith(base + '/') && window.location.pathname !== base)
  ? '/api'
  : (base || '') + '/api'

export { API_BASE }

export function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? m[1] : null
}

export function authHeaders() {
  const token = localStorage.getItem('token')
  const csrf = getCookie('csrf_token') || ''
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrf
  }
}

export function formHeaders() {
  const token = localStorage.getItem('token')
  const csrf = getCookie('csrf_token') || ''
  return {
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrf
  }
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(API_BASE + url, options)
  if (res.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.hash = '#/login'
    throw new Error('Sesión expirada')
  }
  return res
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
