/** Ruta de inicio según rol (evita bucles hacia /dashboard para terapeutas). */
function getHomePath(user) {
  if (!user) return 'login';
  return user.rol === 'terapeuta' ? 'agenda' : 'dashboard';
}

module.exports = { getHomePath };
