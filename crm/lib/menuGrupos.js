const GRUPOS_UI = {
  chats: { label: 'Chats', icon: 'fa-comments', hijos: ['whatsapp', 'social'] },
};

function hijosDe(padre) {
  return GRUPOS_UI[padre] ? GRUPOS_UI[padre].hijos : [];
}

function grupoVisible(permisos, padre) {
  return hijosDe(padre).some(h => permisos.has(h));
}

module.exports = { GRUPOS_UI, hijosDe, grupoVisible };
