const CATEGORIAS = [
  {
    clave: 'principal',
    label: 'Principal',
    items: [
      { clave: 'dashboard', label: 'Dashboard', icon: 'fas fa-gauge-high', href: '/dashboard' },
      { clave: 'agenda', label: 'Agenda', icon: 'fas fa-calendar-days', href: '/agenda' },
      { clave: 'calendario', label: 'Calendario', icon: 'fas fa-calendar-week', href: '/calendario' },
      { clave: 'pacientes', label: 'Pacientes', icon: 'fas fa-users', href: '/pacientes' },
      {
        clave: 'chats',
        label: 'Chats',
        icon: 'fas fa-comments',
        hijos: [
          { clave: 'whatsapp', label: 'WhatsApp', icon: 'fab fa-whatsapp', href: '/whatsapp' },
          { clave: 'social', label: 'Instagram', icon: 'fab fa-instagram', href: '/social' },
        ],
      },
      { clave: 'mi_reporte', label: 'Mi reporte', icon: 'fas fa-chart-bar', href: '/mi-reporte' },
      { clave: 'disponibilidad', label: 'Disponibilidad', icon: 'fas fa-clock', href: '/disponibilidad' },
    ],
  },
  {
    clave: 'clinico',
    label: 'Clínico',
    items: [
      { clave: 'historial', label: 'Historial', icon: 'fas fa-file-medical', href: '/historial' },
      { clave: 'encuestas', label: 'Encuestas', icon: 'fas fa-poll', href: '/encuestas' },
    ],
  },
  {
    clave: 'admin',
    label: 'Administración',
    items: [
      { clave: 'analitica', label: 'Analítica web', icon: 'fas fa-chart-line', href: '/analitica' },
      { clave: 'integraciones', label: 'Integraciones', icon: 'fas fa-plug', href: '/integraciones' },
      { clave: 'paquetes', label: 'Paquetes', icon: 'fas fa-box', href: '/paquetes' },
      { clave: 'terapeutas', label: 'Usuarios', icon: 'fas fa-user-md', href: '/terapeutas' },
      { clave: 'reportes', label: 'Reportes', icon: 'fas fa-chart-bar', href: '/reportes' },
      { clave: 'permisos_menu', label: 'Permisos de menú', icon: 'fas fa-shield-halved', href: '/permisos-menu' },
    ],
  },
  {
    clave: 'reporte-financiero',
    label: 'Reporte Financiero',
    items: [
      { clave: 'reporte_financiero', label: 'Dashboard', icon: 'fas fa-sack-dollar', href: '/reporte-financiero' },
      { clave: 'reporte_financiero_detalles', label: 'Detalles', icon: 'fas fa-list', href: '/reporte-financiero/detalles' },
      { clave: 'distribucion', label: 'Distribución', icon: 'fas fa-hand-holding-dollar', href: '/distribucion' },
    ],
  },
];

function aPlano(item) {
  return { clave: item.clave, label: item.label, icon: item.icon };
}

function categoriasParaCatalogo(catalogo) {
  const porClave = new Map(catalogo.map(r => [r.clave, r]));
  const usadas = new Set();
  const padres = new Set();
  const out = [];

  CATEGORIAS.forEach(cat => {
    const items = [];
    cat.items.forEach(it => {
      if (it.hijos) {
        padres.add(it.clave);
        const hijos = it.hijos.filter(h => porClave.has(h.clave));
        if (!hijos.length) return;
        hijos.forEach(h => usadas.add(h.clave));
        items.push({ clave: it.clave, label: it.label, icon: it.icon, grupo: true, hijos: hijos.map(aPlano) });
        return;
      }
      if (!porClave.has(it.clave)) return;
      usadas.add(it.clave);
      items.push(aPlano(it));
    });
    if (items.length) out.push({ clave: cat.clave, label: cat.label, items });
  });

  const otros = catalogo
    .filter(r => !usadas.has(r.clave) && !padres.has(r.clave))
    .map(r => ({ clave: r.clave, label: r.label, icon: r.icon ? `fas ${r.icon}` : 'fas fa-circle' }));
  if (otros.length) out.push({ clave: 'otros', label: 'Otros', items: otros });

  return out;
}

module.exports = { CATEGORIAS, categoriasParaCatalogo };
