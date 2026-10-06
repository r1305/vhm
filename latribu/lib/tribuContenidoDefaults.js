/** Textos editables del funnel y área miembro (defaults si no hay fila en BD). */

const SLUG_META = {
  landing_hero: { label: 'Landing · Hero', grupo: 'Landing' },
  landing_video: { label: 'Landing · Video', grupo: 'Landing' },
  landing_momentos: { label: 'Landing · Momentos', grupo: 'Landing' },
  landing_agenda: { label: 'Landing · Agenda', grupo: 'Landing' },
  landing_membresia: { label: 'Landing · Membresía', grupo: 'Landing' },
  landing_faq: { label: 'Landing · FAQ', grupo: 'Landing' },
  landing_final: { label: 'Landing · Cierre', grupo: 'Landing' },
  member_inicio: { label: 'Miembro · Inicio', grupo: 'Plataforma' },
  member_biblioteca: { label: 'Miembro · Biblioteca', grupo: 'Plataforma' },
  member_calendario: { label: 'Miembro · Calendario', grupo: 'Plataforma' },
  member_bienestar: { label: 'Miembro · IA bienestar', grupo: 'Plataforma' },
  member_mi_prueba: { label: 'Miembro · Mi prueba', grupo: 'Plataforma' },
  member_recordatorio: { label: 'Miembro · Recordatorio', grupo: 'Plataforma' },
  funnel_checkout: { label: 'Funnel · Checkout', grupo: 'Funnel pago' },
  funnel_confirmacion: { label: 'Funnel · Confirmación', grupo: 'Funnel pago' },
  funnel_crear_contrasena: { label: 'Funnel · Crear contraseña', grupo: 'Funnel pago' },
  funnel_empezar: { label: 'Funnel · Empezar (onboarding)', grupo: 'Funnel pago' },
};

const DEFAULTS = {
  landing_hero: {
    eyebrow: 'Un espacio para crecer, conectar y no tener que hacerlo todo solo.',
    titulo_html: 'Hay cosas que se hacen más fáciles cuando no tienes que atravesarlas <em>solo.</em>',
    lead: 'La Tribu es un espacio de crecimiento personal donde encuentras herramientas psicológicas, sesiones, experiencias y personas reales que también están trabajando en sí mismas.',
    features: 'Sesiones en vivo · Comunidad privada · Recursos prácticos\nActividades · IA de bienestar',
    cta: 'Probar La Tribu 7 días gratis',
    secondary_link: 'Ver qué hay dentro',
    hero_note_title: 'Crecer también\nes encontrar tu lugar.',
    hero_note_sub: 'Aprende · Conversa · Comparte',
    stripe: ['Herramientas para tu día a día', 'Encuentros con sentido', 'A tu propio ritmo'],
  },
  landing_video: {
    tag: 'Vista previa · video por incorporar',
    eyebrow: 'Menos de 90 segundos',
    titulo: 'Mira cómo se vive La Tribu por dentro.',
    lead: 'Herramientas para cuando las necesitas. Conversaciones que acompañan. Experiencias para volver a conectar.',
    cta: 'Quiero probarlo gratis',
    micro: 'El video de bienvenida se publicará con subtítulos antes del lanzamiento.',
  },
  landing_momentos: {
    titulo_html: 'Para esos momentos<br>en que necesitas algo más.',
    subtitulo: 'Un siguiente paso. Una herramienta. Una conversación.',
    items: [
      { num: '01', titulo: 'Cuando tu mente no para', texto: 'Encuentra herramientas concretas para regularte, ordenar lo que estás pensando y volver al presente.' },
      { num: '02', titulo: 'Cuando necesites hablar con alguien que sí entienda', texto: 'Conecta con personas que también están atravesando procesos de crecimiento, cambio y reconstrucción.' },
      { num: '03', titulo: 'Cuando no sepas qué hacer', texto: 'Accede a sesiones, guías y recursos creados para ayudarte a encontrar claridad y dar el siguiente paso.' },
      { num: '04', titulo: 'Cuando quieras volver a sentirte parte de algo', texto: 'Participa en conversaciones, actividades y experiencias que no giran solamente alrededor de tus problemas.' },
      { num: '05', titulo: 'Cuando quieras seguir creciendo', texto: 'Encuentra espacios para conocerte, desarrollar habilidades, construir relaciones y ampliar tu vida.' },
    ],
  },
  landing_agenda: {
    titulo_html: 'Esto está pasando<br>en La Tribu.',
    subtitulo: 'Próximas experiencias (hora Lima, GMT−5).',
    micro: 'Estas son algunas de las experiencias que puedes encontrar cada mes. Confirmar actividades antes de publicar.',
    empty: 'Consulta el calendario completo al entrar a La Tribu.',
    cta: 'Entrar y ver todo el calendario',
  },
  landing_membresia: {
    eyebrow: 'Todo La Tribu · una membresía',
    titulo: 'Puedes conocer La Tribu antes de decidir quedarte.',
    lista: ['Sesiones en vivo', 'Comunidad privada', 'Biblioteca completa', 'Recursos nuevos', 'IA de bienestar', 'Calendario', 'Actividades', 'Mural de logros'],
    tag: '7 días gratis',
    legal: 'Renovación automática. Primer cobro dentro de 7 días. Cancela cuando quieras. Te avisaremos antes de que termine tu prueba.',
    cta: 'Empezar mis 7 días gratis',
  },
  landing_faq: {
    titulo_html: 'Antes de entrar,<br>lo que necesitas saber.',
    items: [
      { pregunta: '¿Tengo que pagar algo hoy?', respuesta: 'No. Empiezas con 7 días gratuitos. Al terminar, la membresía se renueva automáticamente salvo que canceles antes.', clave: 'pago' },
      { pregunta: '¿Puedo cancelar durante los 7 días?', respuesta: 'Sí. En Mi membresía puedes cancelar la renovación antes de finalizar la prueba. Mantienes el acceso hasta su fecha de término.' },
      { pregunta: '¿Por qué me piden una tarjeta?', respuesta: 'Para continuar sin repetir la inscripción si decides quedarte. No se cobra la membresía hoy. La renovación automática y su fecha se muestran antes de confirmar.' },
      { pregunta: '¿La Tribu reemplaza una terapia psicológica?', respuesta: 'No. La Tribu es una comunidad de crecimiento, acompañamiento y aprendizaje. No sustituye atención psicológica o psiquiátrica cuando es necesaria.' },
      { pregunta: '¿Tengo que participar o puedo simplemente observar?', respuesta: 'Puedes ir a tu ritmo. Empieza explorando recursos y participa cuando te sientas preparado.' },
      { pregunta: '¿Qué sucede después de los 7 días?', respuesta: 'Si no cancelas antes, tu tarjeta recibirá el cobro mensual y la membresía seguirá renovándose. Te avisaremos antes del primer cobro.', clave: 'despues' },
    ],
  },
  landing_final: {
    titulo: 'Quizá no necesitas tener todo resuelto para empezar.',
    lead: 'Solo necesitas un lugar donde puedas seguir avanzando.',
    cta: 'Probar La Tribu 7 días gratis',
  },
  member_inicio: {
    eyebrow: 'Un espacio para volver a ti',
    sub_home: 'Aquí tienes algo para continuar hoy.',
    section_continue: 'Continúa donde lo dejaste.',
    section_recommended: 'Recomendado para ti.',
    start_eyebrow: 'Tu primer paso',
    start_titulo: 'Empieza por aquí.',
    start_lead: 'Un recurso corto para volver al presente y sentir el tono de La Tribu.',
  },
  member_biblioteca: {
    eyebrow: 'Biblioteca',
    titulo: '¿Qué necesitas hoy?',
    lead: 'Herramientas para volver al presente, comprender y dar tu siguiente paso.',
    section_titulo: 'Un recurso para cada momento.',
    nota: 'El catálogo crece con guías y videos reales de La Tribu.',
    search_label: 'Buscar por tema o título',
    search_placeholder: 'Por ejemplo: ansiedad, límites o relaciones',
  },
  member_calendario: {
    eyebrow: 'Calendario',
    titulo: 'Lo próximo en La Tribu.',
    lead: 'Encuentra tu próximo espacio. Todos los horarios se muestran en Lima (GMT−5).',
    nota: 'Las fechas y facilitadores pueden actualizarse. Revisa este calendario antes de cada encuentro.',
    empty_week: 'No hay encuentros esta semana con este filtro. Prueba otra categoría o avanza de semana.',
  },
  member_bienestar: {
    eyebrow: 'IA de bienestar',
    titulo: 'Clara · IA de bienestar',
    lead: 'Ordena ideas, explora recursos y encuentra un primer paso. No reemplaza atención profesional.',
  },
  member_mi_prueba: {
    kicker: 'Tu prueba',
    titulo: 'Tus 7 días de prueba',
    intro_default: 'Acceso completo a La Tribu. Te avisaremos antes del primer cobro.',
    timeline_titulo: 'Calendario de la prueba',
    timeline: [
      'Bienvenida: explora la biblioteca y saluda en comunidad.',
      'Elige un recurso corto y déjate llevar por el tono de La Tribu.',
      'Reserva o anota un encuentro en vivo en el calendario.',
      'Comparte un pequeño logro o reflexión en el mural.',
      'Prueba Clara para ordenar una idea o encontrar un recurso.',
      'Revisa tu membresía: mañana termina la prueba si no cancelas.',
      'Último día de prueba: decide si continúas o cancelas antes del cobro.',
    ],
    no_trial: 'Ya no estás en periodo de prueba. Tu membresía sigue activa según tu plan.',
    sin_prueba: 'No tienes una prueba activa en este momento.',
  },
  member_recordatorio: {
    kicker: 'Día 6 · Recordatorio',
    titulo: 'Mañana termina tu prueba gratuita',
    body: 'Si La Tribu te está acompañando, no tienes que hacer nada: mañana se renovará tu membresía con el cobro acordado. Si prefieres no continuar, cancela hoy desde Mi membresía.',
    body_early: 'Tu prueba aún tiene {dias} días. Este recordatorio aplica cuando falte un día para el fin de la prueba.',
  },
  funnel_checkout: {
    login_link: '¿Ya eres miembro? Inicia sesión',
    eyebrow: 'Tu lugar en La Tribu',
    titulo: 'Estás a un paso de entrar a La Tribu.',
    lead: 'Empieza hoy. Tus primeros {trial_dias} días son gratuitos.',
    renew_line: 'Después, {precio} al mes con renovación automática.',
    summary_micro: 'Cancela cuando quieras desde Mi membresía. Te avisaremos antes de terminar tu prueba.',
    unlock_title: 'Hoy desbloqueas',
    unlock_list: ['Comunidad', 'Sesiones', 'Biblioteca', 'Calendario', 'IA de bienestar', 'Actividades'],
    form_title: 'Empieza con {trial_dias} días gratis.',
    sandbox_hint: 'Modo prueba Culqi: puedes usar 4111 1111 1111 1111, CVC 123 y vencimiento futuro.',
    terms: 'Entiendo que hoy pago S/0 y que el {fecha_renovacion} empieza la renovación automática de {precio} mensuales. Puedo cancelar antes desde Mi membresía.',
    submit: 'Empezar mis {trial_dias} días gratis',
    form_foot: 'Sin cobro hoy · Cancela cuando quieras\nPago seguro con Culqi',
    pci_note: 'Los datos de tarjeta se envían cifrados a Culqi. La Tribu no guarda tu número completo ni el CVC.',
  },
  funnel_confirmacion: {
    login_link: '¿Ya eres miembro? Inicia sesión',
    tag: 'Prueba activada',
    titulo: 'Ya estás dentro de La Tribu.',
    lead: 'Vamos a hacer que tus primeros 5 minutos valgan la pena.',
    steps: ['Tu cuenta', 'Conocerte', 'Tu primer camino'],
    cta_default: 'Empezar',
    cta_inicio: 'Entrar a La Tribu',
    micro_fallback: 'Tu prueba termina el <strong>{fecha}</strong>.<br>Después {precio} al mes, salvo que canceles antes.',
    micro_trial: 'Tu prueba termina el <strong>{fecha}</strong>.<br>Después {precio} al mes, salvo que canceles antes.',
    secondary_inicio: 'Ir al inicio del miembro',
    secondary_membresia: 'Ver mi membresía',
  },
  funnel_crear_contrasena: {
    login_link: '¿Ya eres miembro? Inicia sesión',
    step_label: '1 de 3 · Tu cuenta',
    titulo: 'Un acceso para volver cuando quieras.',
    lead: 'Tu correo ya está listo. Solo falta crear tu contraseña.',
    submit: 'Continuar',
    foot: 'Puedes añadir una foto cuando explores tu perfil. Es opcional.',
  },
  funnel_empezar: {
    login_link: '¿Ya eres miembro? Inicia sesión',
    max_objetivos: 3,
    max_intereses: 3,
    step_labels: ['1 de 3 · ¿Qué buscas?', '2 de 3 · Cómo empezar', '3 de 3 · Tus intereses'],
    steps: [
      {
        titulo: '¿Qué te gustaría encontrar en La Tribu?',
        lead: 'Puedes elegir varias opciones. No tienes que tenerlo todo claro.',
        micro: 'Tus elecciones ayudan a recomendar recursos; no son una evaluación psicológica.',
        skip: 'Omitir por ahora',
        cta: 'Continuar',
      },
      {
        titulo: '¿Cómo prefieres empezar?',
        lead: 'Puedes empezar observando. La participación social es opcional.',
        micro: 'Tus elecciones ayudan a recomendar recursos; no son una evaluación psicológica.',
        skip: 'Omitir por ahora',
        cta: 'Continuar',
      },
      {
        titulo: 'Queremos recomendarte algo que realmente te sirva.',
        lead: 'Elige hasta 3 intereses. Puedes cambiarlos más adelante.',
        micro: 'Tus elecciones ayudan a recomendar recursos; no son una evaluación psicológica.',
        skip: 'Omitir por ahora',
        cta: 'Ver mi primer camino',
      },
    ],
    intereses_count: '{n} de {max} intereses seleccionados',
    intereses_limit: 'Ya elegiste 3. Puedes desmarcar uno para cambiar.',
    como_opciones: [
      { id: 'recursos', label: 'Viendo recursos por mi cuenta' },
      { id: 'calendario', label: 'Participando en sesiones' },
      { id: 'comunidad', label: 'Conociendo personas' },
      { id: 'incierto', label: 'No estoy seguro todavía' },
    ],
  },
};

function listSlugs() {
  return Object.keys(SLUG_META);
}

function getDefault(slug) {
  const d = DEFAULTS[slug];
  return d ? JSON.parse(JSON.stringify(d)) : null;
}

function getMeta(slug) {
  return SLUG_META[slug] || { label: slug, grupo: 'Otro' };
}

module.exports = { SLUG_META, DEFAULTS, listSlugs, getDefault, getMeta };
