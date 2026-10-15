(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MenuGruposUI = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function estadoPadre(marcados, hijos) {
    const n = hijos.filter(h => marcados.has(h)).length;
    if (!hijos.length || n === 0) return 'vacio';
    return n === hijos.length ? 'marcado' : 'indeterminado';
  }

  function aplicarPadre(marcados, hijos, valor) {
    const out = new Set(marcados);
    for (const h of hijos) {
      if (valor) out.add(h);
      else out.delete(h);
    }
    return out;
  }

  return { estadoPadre, aplicarPadre };
});
