/** Etiquetas, validación y combinación con defaults del contenido editable. */
const { DEFAULTS, getDefault } = require('./tribuContenidoDefaults');

const MAX_CORTO = 300;
const MAX_LARGO = 2000;
const MAX_ITEMS = 30;

const DONDE = {
  landing_hero: 'Landing, primera pantalla',
  landing_video: 'Landing, bloque del video',
  landing_momentos: 'Landing, sección «Para esos momentos…»',
  landing_agenda: 'Landing, sección de próximas actividades',
  landing_membresia: 'Landing, recuadro de la membresía',
  landing_faq: 'Landing, preguntas frecuentes',
  landing_final: 'Landing, cierre al final de la página',
  member_inicio: 'Área del miembro, pantalla de inicio',
  member_biblioteca: 'Área del miembro, Biblioteca',
  member_calendario: 'Área del miembro, Calendario',
  member_bienestar: 'Área del miembro, IA de bienestar (Clara)',
  member_mi_prueba: 'Área del miembro, Mi prueba',
  member_recordatorio: 'Área del miembro, aviso del día 6 de la prueba',
  funnel_checkout: 'Página de pago (checkout)',
  funnel_confirmacion: 'Página de confirmación tras el pago',
  funnel_crear_contrasena: 'Página para crear la contraseña',
  funnel_empezar: 'Preguntas de bienvenida (onboarding)',
};

const CAMPOS = {
  eyebrow: ['Frase pequeña sobre el título', 'Texto corto que aparece encima del título principal.'],
  titulo: ['Título', 'Título principal de esta parte.'],
  titulo_html: ['Título (con formato)', 'Título principal de esta parte.'],
  lead: ['Texto de introducción', 'Párrafo que va justo debajo del título.'],
  subtitulo: ['Subtítulo', 'Frase que va debajo del título.'],
  features: ['Lista de beneficios', 'Beneficios bajo la introducción.'],
  cta: ['Texto del botón principal', 'Lo que dice el botón que invita a probar o continuar.'],
  secondary_link: ['Texto del enlace secundario', 'Enlace pequeño junto al botón principal.'],
  hero_note_title: ['Título de la nota destacada', 'Nota que acompaña la imagen principal.'],
  hero_note_sub: ['Texto pequeño de la nota destacada', 'Línea debajo del título de la nota.'],
  stripe: ['Frases de la franja', 'Frases cortas en la franja de color bajo la primera pantalla.'],
  tag: ['Etiqueta', 'Etiqueta pequeña destacada.'],
  micro: ['Nota pequeña', 'Texto pequeño de aclaración.'],
  items: ['Elementos', 'Cada elemento es una tarjeta o pregunta de esta sección.'],
  empty: ['Mensaje cuando no hay actividades', 'Se muestra si no hay actividades próximas para mostrar.'],
  lista: ['Lista de lo que incluye', 'Cada línea es un punto de la lista de la membresía.'],
  legal: ['Aviso de renovación', 'Texto pequeño sobre el cobro y la renovación automática.'],
  sub_home: ['Saludo de inicio', 'Frase bajo el saludo al entrar.'],
  section_continue: ['Título «Continúa»', 'Título del bloque con lo que la persona dejó a medias.'],
  section_recommended: ['Título «Recomendado»', 'Título del bloque de recomendaciones.'],
  start_eyebrow: ['Frase pequeña del primer paso', 'Encima del bloque «Empieza por aquí».'],
  start_titulo: ['Título del primer paso', 'Título del bloque para personas nuevas.'],
  start_lead: ['Texto del primer paso', 'Explicación del bloque para personas nuevas.'],
  section_titulo: ['Título de la sección', 'Título sobre la lista de recursos.'],
  nota: ['Nota informativa', 'Aviso pequeño de la página.'],
  search_label: ['Etiqueta del buscador', 'Texto sobre la caja de búsqueda.'],
  search_placeholder: ['Ejemplo dentro del buscador', 'Texto gris que se ve dentro de la caja de búsqueda vacía.'],
  empty_week: ['Mensaje de semana sin encuentros', 'Se muestra si no hay encuentros en la semana elegida.'],
  kicker: ['Frase pequeña sobre el título', 'Texto corto que aparece encima del título.'],
  intro_default: ['Texto de introducción', 'Párrafo bajo el título.'],
  timeline_titulo: ['Título del calendario de la prueba', 'Título sobre la lista de días.'],
  timeline: ['Mensaje de cada día', 'Una línea por día de la prueba, en orden (día 1, día 2…).'],
  no_trial: ['Mensaje si ya no está en prueba', 'Se muestra a quien ya pagó la membresía.'],
  sin_prueba: ['Mensaje sin prueba activa', 'Se muestra a quien no tiene una prueba en curso.'],
  body: ['Mensaje principal', 'Texto del aviso.'],
  body_early: ['Mensaje si aún faltan días', 'Se muestra si la persona entra antes del día 6.'],
  login_link: ['Enlace para iniciar sesión', 'Enlace arriba para quien ya es miembro.'],
  renew_line: ['Línea de renovación', 'Explica el cobro después de la prueba.'],
  summary_micro: ['Nota del resumen', 'Texto pequeño bajo el resumen del plan.'],
  unlock_title: ['Título «Hoy desbloqueas»', 'Título sobre la lista de lo que incluye.'],
  unlock_list: ['Lo que desbloquea', 'Cada línea es un punto de la lista.'],
  form_title: ['Título del formulario', 'Título sobre el formulario de pago.'],
  sandbox_hint: ['Ayuda del modo prueba', 'Solo se ve cuando los pagos están en modo prueba.'],
  terms: ['Texto de aceptación', 'Texto junto a la casilla que la persona debe marcar.'],
  submit: ['Texto del botón de enviar', 'Lo que dice el botón del formulario.'],
  form_foot: ['Pie del formulario', 'Texto pequeño bajo el botón de pago.'],
  pci_note: ['Nota de seguridad del pago', 'Explica que los datos de tarjeta van cifrados.'],
  steps: ['Pasos', 'Cada elemento es un paso, en orden.'],
  cta_default: ['Texto del botón', 'Botón principal de la página.'],
  cta_inicio: ['Texto del botón (al terminar)', 'Botón cuando la persona ya completó los pasos.'],
  micro_fallback: ['Nota de fin de prueba (general)', 'Texto pequeño con la fecha de fin de la prueba.'],
  micro_trial: ['Nota de fin de prueba', 'Texto pequeño con la fecha de fin de la prueba.'],
  secondary_inicio: ['Enlace «Ir al inicio»', 'Enlace secundario hacia el inicio del miembro.'],
  secondary_membresia: ['Enlace «Mi membresía»', 'Enlace secundario hacia la membresía.'],
  step_label: ['Indicador de paso', 'Texto pequeño que dice en qué paso va la persona.'],
  foot: ['Nota al pie', 'Texto pequeño bajo el formulario.'],
  max_objetivos: ['Máximo de objetivos que se pueden elegir', 'Número de opciones que la persona puede marcar en el paso 1.'],
  max_intereses: ['Máximo de intereses que se pueden elegir', 'Número de opciones que la persona puede marcar en el paso 3.'],
  step_labels: ['Indicador de cada paso', 'Texto pequeño de cada paso, en orden (3 pasos).'],
  intereses_count: ['Contador de intereses', 'Se actualiza al marcar intereses.'],
  intereses_limit: ['Aviso de límite de intereses', 'Se muestra al llegar al máximo.'],
  como_opciones: ['Opciones de «Cómo prefieres empezar»', 'Opciones del paso 2.'],
};

const SUBCAMPOS = {
  num: ['Número', 'Número que se ve en la tarjeta (por ejemplo 01).'],
  titulo: ['Título', ''],
  texto: ['Texto', ''],
  pregunta: ['Pregunta', ''],
  respuesta: ['Respuesta', ''],
  clave: ['Código interno (opcional)', 'No lo cambies: la página lo usa para completar el precio y la fecha automáticamente.'],
  lead: ['Texto de introducción', ''],
  micro: ['Nota pequeña', ''],
  skip: ['Texto del enlace «Omitir»', ''],
  cta: ['Texto del botón', ''],
  id: ['Código interno', 'No lo cambies en opciones existentes. En una nueva, usa una palabra sin espacios.'],
  label: ['Texto de la opción', ''],
};

const MARCADORES = {
  '{precio}': 'se reemplaza por el precio mensual configurado en Ajustes',
  '{trial_dias}': 'se reemplaza por los días de prueba gratis',
  '{fecha_renovacion}': 'se reemplaza por la fecha del primer cobro',
  '{fecha}': 'se reemplaza por la fecha de fin de la prueba',
  '{dias}': 'se reemplaza por los días que le quedan a la prueba',
  '{n}': 'se reemplaza por cuántos intereses lleva marcados',
  '{max}': 'se reemplaza por el máximo de intereses permitido',
};

const LISTAS_FIJAS = new Set(['funnel_empezar.steps', 'funnel_empezar.step_labels']);
const HTML_PELIGROSO = /<\s*(script|iframe|object|embed|style)|\son\w+\s*=|javascript:/i;

function esHtml(clave, def) {
  return clave.endsWith('_html') || /<[a-z][^>]*>/i.test(def);
}

function tipoDe(clave, def) {
  if (typeof def === 'number') return 'numero';
  if (Array.isArray(def)) return def.every(x => typeof x === 'string') ? 'lista' : 'lista_obj';
  if (esHtml(clave, def)) return 'html';
  return def.length > 80 || def.includes('\n') ? 'largo' : 'corto';
}

function marcadoresDe(valor) {
  const txt = JSON.stringify(valor);
  return Object.keys(MARCADORES).filter(m => txt.includes(m)).map(m => ({ marca: m, explicacion: MARCADORES[m] }));
}

function subcamposDe(def) {
  const todas = [...new Set(def.flatMap(Object.keys))];
  return todas.map(k => {
    const largo = def.some(it => typeof it[k] === 'string' && it[k].length > 80);
    return {
      clave: k,
      etiqueta: (SUBCAMPOS[k] || [k, ''])[0],
      ayuda: (SUBCAMPOS[k] || [k, ''])[1],
      opcional: !def.every(it => k in it),
      largo,
      max: largo ? MAX_LARGO : MAX_CORTO,
    };
  });
}

function describirCampos(slug) {
  const defs = DEFAULTS[slug];
  if (!defs) return [];
  const donde = DONDE[slug] || '';
  return Object.keys(defs).map(clave => {
    const def = defs[clave];
    const tipo = tipoDe(clave, def);
    const info = CAMPOS[clave] || [clave, ''];
    const campo = {
      clave,
      tipo,
      etiqueta: info[0],
      ayuda: [info[1], donde && 'Se ve en: ' + donde + '.'].filter(Boolean).join(' '),
      marcadores: marcadoresDe(def),
      saltosDeLinea: typeof def === 'string' && def.includes('\n'),
    };
    if (tipo === 'numero') { campo.min = 1; campo.max = 20; }
    else if (tipo === 'lista') { campo.max = MAX_CORTO; campo.maxItems = MAX_ITEMS; }
    else if (tipo === 'lista_obj') { campo.subcampos = subcamposDe(def); campo.maxItems = MAX_ITEMS; }
    else campo.max = tipo === 'corto' ? MAX_CORTO : MAX_LARGO;
    if (LISTAS_FIJAS.has(slug + '.' + clave)) campo.fijos = def.length;
    return campo;
  });
}

function errorTexto(valor, max) {
  if (typeof valor !== 'string') return 'debe ser un texto';
  if (!valor.trim()) return 'no puede quedar vacío';
  if (valor.length > max) return `es demasiado largo (máximo ${max} caracteres, tiene ${valor.length})`;
  if (valor.includes('<') && HTML_PELIGROSO.test(valor)) return 'contiene código no permitido (scripts o eventos)';
  return null;
}

function validarCampo(campo, valor) {
  const errores = [];
  const add = (ruta, mensaje) => errores.push({ campo: ruta, etiqueta: campo.etiqueta, mensaje });
  const c = campo.clave;
  if (campo.tipo === 'numero') {
    if (!Number.isInteger(valor) || valor < campo.min || valor > campo.max) add(c, `debe ser un número entero entre ${campo.min} y ${campo.max}`);
    return errores;
  }
  if (campo.tipo === 'lista' || campo.tipo === 'lista_obj') {
    if (!Array.isArray(valor)) { add(c, 'debe ser una lista'); return errores; }
    if (!valor.length) add(c, 'la lista no puede quedar vacía');
    if (valor.length > campo.maxItems) add(c, `tiene demasiados elementos (máximo ${campo.maxItems})`);
    if (campo.fijos && valor.length !== campo.fijos) add(c, `debe tener exactamente ${campo.fijos} elementos`);
    valor.forEach((it, i) => {
      const ruta = `${c}.${i}`;
      if (campo.tipo === 'lista') {
        const e = errorTexto(it, campo.max);
        if (e) add(ruta, `elemento ${i + 1}: ${e}`);
        return;
      }
      if (!it || typeof it !== 'object' || Array.isArray(it)) { add(ruta, `elemento ${i + 1}: formato incorrecto`); return; }
      const conocidas = campo.subcampos.map(s => s.clave);
      Object.keys(it).filter(k => !conocidas.includes(k)).forEach(k => add(ruta, `elemento ${i + 1}: dato desconocido «${k}»`));
      campo.subcampos.forEach(s => {
        if (s.opcional && (it[s.clave] === undefined || it[s.clave] === '')) return;
        const e = errorTexto(it[s.clave], s.max);
        if (e) add(`${ruta}.${s.clave}`, `elemento ${i + 1}, ${s.etiqueta}: ${e}`);
      });
    });
    return errores;
  }
  const e = errorTexto(valor, campo.max);
  if (e) add(c, e);
  return errores;
}

/** Devuelve [] si `datos` es válido para la sección; si no, [{campo, etiqueta, mensaje}]. */
function validarDatos(slug, datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return [{ campo: '', etiqueta: '', mensaje: 'Los datos deben ser un objeto' }];
  }
  const campos = describirCampos(slug);
  const porClave = Object.fromEntries(campos.map(c => [c.clave, c]));
  const errores = Object.keys(datos)
    .filter(k => !porClave[k])
    .map(k => ({ campo: k, etiqueta: k, mensaje: `«${k}» no es un campo de esta sección` }));
  campos.forEach(c => { if (c.clave in datos) errores.push(...validarCampo(c, datos[c.clave])); });
  return errores;
}

function utilizable(def, val) {
  if (typeof def === 'number') return typeof val === 'number' && Number.isFinite(val) && val > 0;
  if (Array.isArray(def)) {
    if (!Array.isArray(val) || !val.length) return false;
    return typeof def[0] === 'string'
      ? val.every(x => typeof x === 'string')
      : val.every(x => x && typeof x === 'object' && !Array.isArray(x));
  }
  return typeof val === 'string' && val.trim() !== '';
}

/** Usa lo guardado si sirve y el texto original en lo que falte, esté vacío o tenga el tipo equivocado. No escribe en BD. */
function combinarConDefaults(slug, guardado) {
  const def = getDefault(slug);
  if (!def) return guardado || null;
  if (!guardado || typeof guardado !== 'object' || Array.isArray(guardado)) return def;
  for (const k of Object.keys(def)) {
    if (utilizable(def[k], guardado[k])) def[k] = guardado[k];
  }
  return def;
}

module.exports = { describirCampos, validarDatos, combinarConDefaults, DONDE };
