const MENU_GRUPOS = {
  chats: ['whatsapp', 'social'],
};

function hijosDe(padre) {
  return MENU_GRUPOS[padre] || [];
}

function expandirGrupos(permisos) {
  const out = new Set(permisos);
  for (const [padre, hijos] of Object.entries(MENU_GRUPOS)) {
    if (permisos.has(padre)) for (const h of hijos) out.add(h);
  }
  return out;
}

function grupoVisible(permisos, padre) {
  if (permisos.has(padre)) return true;
  return hijosDe(padre).some(h => permisos.has(h));
}

module.exports = { MENU_GRUPOS, hijosDe, expandirGrupos, grupoVisible };
