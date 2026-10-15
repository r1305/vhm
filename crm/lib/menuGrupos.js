const { CATEGORIAS } = require('./menuCategorias');

const GRUPOS_UI = {};
CATEGORIAS.forEach(cat => cat.items.forEach(it => {
  if (it.hijos) GRUPOS_UI[it.clave] = { label: it.label, icon: it.icon, hijos: it.hijos.map(h => h.clave) };
}));

function hijosDe(padre) {
  return GRUPOS_UI[padre] ? GRUPOS_UI[padre].hijos : [];
}

function grupoVisible(permisos, padre) {
  return hijosDe(padre).some(h => permisos.has(h));
}

module.exports = { GRUPOS_UI, hijosDe, grupoVisible };
