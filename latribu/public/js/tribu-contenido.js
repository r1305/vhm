/* tribu-contenido.js — textos desde GET /api/contenido/:slug */

(function (global) {
  const API = (typeof resolveBase === 'function' ? resolveBase() : (global.__APP_BASE__ || '')).replace(/\/+$/, '') + '/api';

  async function load(slug) {
    try {
      const res = await fetch(API + '/contenido/' + encodeURIComponent(slug));
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function setText(el, val) {
    if (!el || val == null || val === '') return;
    el.textContent = val;
  }

  function setHtml(el, val) {
    if (!el || val == null || val === '') return;
    el.innerHTML = val;
  }

  global.TribuContenido = { load, setText, setHtml, API };
})(window);
