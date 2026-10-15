/** Ruta de inicio: /inicio resuelve la primera vista permitida del usuario. */
function getHomePath(user) {
  if (!user) return 'login';
  return 'inicio';
}

const VIEW_PATHS = [
  ['dashboard', 'dashboard'],
  ['agenda', 'agenda'],
  ['calendario', 'calendario'],
  ['pacientes', 'pacientes'],
  ['paquetes', 'paquetes'],
  ['whatsapp', 'whatsapp'],
  ['social', 'social'],
  ['mi_reporte', 'mi-reporte'],
  ['disponibilidad', 'disponibilidad'],
  ['historial', 'historial'],
  ['encuestas', 'encuestas'],
  ['analitica', 'analitica'],
  ['integraciones', 'integraciones'],
  ['terapeutas', 'terapeutas'],
  ['reportes', 'reportes'],
  ['permisos_menu', 'permisos-menu'],
  ['reporte_financiero', 'reporte-financiero'],
  ['reporte_financiero_detalles', 'reporte-financiero/detalles'],
  ['distribucion', 'distribucion'],
];

function primeraVistaPermitida(permisos) {
  const found = VIEW_PATHS.find(([clave]) => permisos.has(clave));
  return found ? found[1] : null;
}

module.exports = { getHomePath, VIEW_PATHS, primeraVistaPermitida };
