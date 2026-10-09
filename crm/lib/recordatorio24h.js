const pool = require('./db');
const { sendWhatsAppGreen, loadOpenwaConfigFromDB, isOpenwaConfigured } = require('./greenapi');
const { normalizePhone } = require('./openwa');
const { normHora, instanteLima } = require('./reservaCita');

const entero = (v, def) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : def; };

const REC24_CRON = '*/10 * * * *';
const REC24_HORAS_ANTES = entero(process.env.REC24_HORAS_ANTES, 24);
const REC24_MIN_HORAS_ANTES = entero(process.env.REC24_MIN_HORAS_ANTES, 2);
const REC24_MAX_INTENTOS = entero(process.env.REC24_MAX_INTENTOS, 3);
const REC24_LOCK_MIN = Math.max(1, entero(process.env.REC24_LOCK_MIN, 15));
const REC24_LIMITE = 200;
const ESTADOS_RECORDATORIO = ['pendiente', 'confirmada', 'reagendada'];
const CLAVE_ACTIVO = 'recordatorio_24h_activo';
const CLAVE_MENSAJE = 'recordatorio_24h_mensaje';
const HORA_MS = 3600000;

const PLANTILLA_DEFECTO = [
  'Hola {nombre}, te recordamos tu cita en VHM Centro de Psicología.',
  'Fecha: {fecha}',
  'Hora: {hora} (hora de Lima)',
  'Terapeuta: {terapeuta}',
  'Modalidad: {modalidad}{enlace}',
  'Si necesitas reprogramar o cancelar, responde a este mensaje.',
].join('\n');

const MODALIDAD_LABEL = {
  presencial: 'Presencial',
  videollamada: 'Videollamada',
  telefono: 'Llamada telefónica',
};

const limaDateTime = (ms) => new Date(ms - 5 * HORA_MS).toISOString().slice(0, 19).replace('T', ' ');

function envInterruptor() {
  const v = String(process.env.RECORDATORIO_24H_ENABLED ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  if (['1', 'true', 'on', 'si', 'sí'].includes(v)) return true;
  return null;
}

function ventanaRecordatorio24h(ahora = new Date()) {
  const base = ahora.getTime();
  return {
    desdeMs: base + REC24_MIN_HORAS_ANTES * HORA_MS,
    hastaMs: base + REC24_HORAS_ANTES * HORA_MS,
  };
}

function inicioCitaMs(cita) {
  const fecha = String(cita.fecha ?? '').slice(0, 10);
  if (!normHora(cita.hora_inicio)) return NaN;
  return instanteLima(fecha, cita.hora_inicio).getTime();
}

function seleccionarCitas24h(citas, ahora = new Date()) {
  const { desdeMs, hastaMs } = ventanaRecordatorio24h(ahora);
  return (citas || []).filter((c) => {
    if (!ESTADOS_RECORDATORIO.includes(c.estado)) return false;
    const ini = inicioCitaMs(c);
    return Number.isFinite(ini) && ini >= desdeMs && ini <= hastaMs;
  });
}

function claveRecordatorio24h(cita) {
  const fecha = String(cita.fecha).slice(0, 10).replace(/-/g, '');
  const hora = String(normHora(cita.hora_inicio) || '').slice(0, 5).replace(':', '');
  return `wsp24h:${cita.id}:${fecha}${hora}`;
}

function fechaLegible(cita) {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(inicioCitaMs(cita)));
}

function mensajeRecordatorio24h(cita, plantilla) {
  const tpl = String(plantilla || '').trim() || PLANTILLA_DEFECTO;
  const terapeuta = [cita.t_nombre, cita.t_apellido].filter(Boolean).join(' ').trim() || 'tu terapeuta';
  const virtual = cita.modalidad === 'videollamada';
  const meet = virtual && cita.meet_link ? String(cita.meet_link) : '';
  const valores = {
    nombre: String(cita.nombre || '').trim(),
    apellido: String(cita.apellido || '').trim(),
    fecha: fechaLegible(cita),
    hora: String(normHora(cita.hora_inicio) || '').slice(0, 5),
    terapeuta,
    modalidad: MODALIDAD_LABEL[cita.modalidad] || String(cita.modalidad || ''),
    meet_link: meet,
    enlace: meet ? `\nEnlace de la sesión: ${meet}` : '',
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(valores, k) ? valores[k] : m));
}

async function leerConfig(db, clave) {
  const [[row]] = await db.execute('SELECT valor FROM configuracion WHERE clave=? LIMIT 1', [clave]);
  return row?.valor ?? null;
}

async function recordatorio24hActivo(db = pool) {
  const env = envInterruptor();
  if (env !== null) return env;
  const v = String((await leerConfig(db, CLAVE_ACTIVO)) ?? '').trim();
  return v === '1' || v.toLowerCase() === 'true';
}

async function cargarCitasCandidatas(db, ahora, soloPacienteId) {
  const { desdeMs, hastaMs } = ventanaRecordatorio24h(ahora);
  const desde = limaDateTime(desdeMs);
  const hasta = limaDateTime(hastaMs);
  const params = [desde.slice(0, 10), hasta.slice(0, 10), desde, hasta];
  let sql = `SELECT c.id, c.paciente_id, DATE_FORMAT(c.fecha,'%Y-%m-%d') AS fecha, c.hora_inicio,
                    c.estado, c.modalidad, c.meet_link,
                    p.nombre, p.apellido, p.telefono,
                    t.nombre AS t_nombre, t.apellido AS t_apellido
             FROM citas c
             JOIN pacientes p ON p.id = c.paciente_id
             LEFT JOIN terapeutas t ON t.id = c.terapeuta_id
             WHERE c.estado IN ('pendiente','confirmada','reagendada')
               AND c.fecha BETWEEN ? AND ?
               AND TIMESTAMP(c.fecha, c.hora_inicio) BETWEEN ? AND ?`;
  if (soloPacienteId) { sql += ' AND c.paciente_id = ?'; params.push(soloPacienteId); }
  sql += ` ORDER BY c.fecha, c.hora_inicio LIMIT ${REC24_LIMITE}`;
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function reclamarEnvio(db, cita, clave) {
  const programado = limaDateTime(inicioCitaMs(cita) - REC24_HORAS_ANTES * HORA_MS);
  await db.execute(
    `INSERT INTO recordatorios (paciente_id, cita_id, tipo, canal, programado_at, enviado, intentos, procesando, clave)
     VALUES (?, ?, 'recordatorio_cita', 'whatsapp', ?, 0, 0, 0, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [cita.paciente_id, cita.id, programado, clave]
  );
  const [r] = await db.execute(
    `UPDATE recordatorios SET intentos = intentos + 1, procesando = 1, procesando_desde = NOW()
     WHERE clave = ? AND enviado = 0 AND intentos < ?
       AND (procesando = 0 OR procesando_desde IS NULL OR procesando_desde < NOW() - INTERVAL ? MINUTE)`,
    [clave, REC24_MAX_INTENTOS, REC24_LOCK_MIN]
  );
  return r.affectedRows === 1;
}

async function estadoRegistro(db, clave) {
  const [[row]] = await db.execute(
    `SELECT enviado, intentos, procesando,
            (procesando = 1 AND (procesando_desde IS NULL OR procesando_desde < NOW() - INTERVAL ? MINUTE)) AS atascado
     FROM recordatorios WHERE clave=? LIMIT 1`,
    [REC24_LOCK_MIN, clave]
  );
  return row || null;
}

async function comprobarOpenwa() {
  await loadOpenwaConfigFromDB();
  return isOpenwaConfigured();
}

const pausa = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function procesarRecordatorios24h({
  ahora = new Date(),
  soloPacienteId = null,
  dryRun = false,
  db = pool,
  enviar = sendWhatsAppGreen,
  verificarOpenwa = comprobarOpenwa,
  pausaMs = 1000,
  plantilla,
} = {}) {
  const { desdeMs, hastaMs } = ventanaRecordatorio24h(ahora);
  const res = {
    ok: true,
    dryRun: !!dryRun,
    ventana: { desde: limaDateTime(desdeMs), hasta: limaDateTime(hastaMs) },
    candidatas: 0,
    enviados: 0,
    omitidos: [],
    errores: [],
    detalle: [],
  };

  const citas = seleccionarCitas24h(await cargarCitasCandidatas(db, ahora, soloPacienteId), ahora);
  res.candidatas = citas.length;
  if (!citas.length) return res;

  const tpl = plantilla !== undefined ? plantilla : await leerConfig(db, CLAVE_MENSAJE);

  if (!dryRun && !(await verificarOpenwa())) {
    res.ok = false;
    res.sinConfig = true;
    return res;
  }

  let primero = true;
  for (const cita of citas) {
    const telefono = normalizePhone(cita.telefono);
    if (!telefono || telefono.length < 8) {
      res.omitidos.push({ cita_id: cita.id, motivo: 'sin_telefono' });
      continue;
    }
    const clave = claveRecordatorio24h(cita);
    const mensaje = mensajeRecordatorio24h(cita, tpl);

    if (dryRun) {
      const reg = await estadoRegistro(db, clave);
      const atascado = !!(reg && Number(reg.atascado));
      if (reg && (reg.enviado || (reg.procesando && !atascado) || reg.intentos >= REC24_MAX_INTENTOS)) {
        res.omitidos.push({ cita_id: cita.id, motivo: reg.enviado ? 'ya_enviado' : 'bloqueado_o_agotado', clave });
        continue;
      }
      res.detalle.push({ cita_id: cita.id, paciente_id: cita.paciente_id, telefono, clave, mensaje, accion: 'enviaria', ...(atascado ? { recupera_bloqueo: true } : {}) });
      continue;
    }

    if (!(await reclamarEnvio(db, cita, clave))) {
      res.omitidos.push({ cita_id: cita.id, motivo: 'ya_enviado_o_en_curso', clave });
      continue;
    }

    if (!primero) await pausa(pausaMs);
    primero = false;

    try {
      const r = await enviar({ to: cita.telefono, message: mensaje });
      if (!r || r.skipped) throw new Error('OpenWA no configurado');
      await db.execute(
        `UPDATE recordatorios SET enviado = 1, enviado_at = NOW(), procesando = 0, procesando_desde = NULL, ultimo_error = NULL, mensaje = ?
         WHERE clave = ?`,
        [mensaje, clave]
      );
      await db.execute('UPDATE citas SET recordatorio_24h = 1 WHERE id = ?', [cita.id]);
      res.enviados++;
      res.detalle.push({ cita_id: cita.id, paciente_id: cita.paciente_id, telefono, clave, accion: 'enviado' });
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 500);
      const relevo = err?.code === 'duplicate_instance';
      console.error('[recordatorio24h] cita=%s clave=%s:', cita.id, clave, msg);
      await db.execute(
        relevo
          ? 'UPDATE recordatorios SET procesando = 0, procesando_desde = NULL, ultimo_error = ?, intentos = GREATEST(intentos - 1, 0) WHERE clave = ?'
          : 'UPDATE recordatorios SET procesando = 0, procesando_desde = NULL, ultimo_error = ? WHERE clave = ?',
        [msg, clave]
      ).catch((e) => console.error('[recordatorio24h] registrar error cita=%s:', cita.id, e.message));
      res.errores.push({ cita_id: cita.id, clave, error: msg, ...(relevo ? { code: err.code } : {}) });
      if (relevo) {
        res.interrumpido = 'duplicate_instance';
        break;
      }
    }
  }

  if (res.errores.length) res.ok = false;
  return res;
}

let _enCurso = false;

async function ejecutarCronRecordatorios24h(opts = {}) {
  if (_enCurso) return { omitido: true, motivo: 'en_curso' };
  _enCurso = true;
  try {
    if (!(await recordatorio24hActivo(opts.db || pool))) return { omitido: true, motivo: 'desactivado' };
    const res = await procesarRecordatorios24h(opts);
    if (res.candidatas) {
      console.log('[recordatorio24h] candidatas=%d enviados=%d omitidos=%d errores=%d%s',
        res.candidatas, res.enviados, res.omitidos.length, res.errores.length,
        res.interrumpido ? ` interrumpido=${res.interrumpido}` : '');
    }
    return res;
  } finally {
    _enCurso = false;
  }
}

module.exports = {
  REC24_CRON,
  REC24_HORAS_ANTES,
  REC24_MIN_HORAS_ANTES,
  REC24_MAX_INTENTOS,
  REC24_LOCK_MIN,
  ESTADOS_RECORDATORIO,
  CLAVE_ACTIVO,
  CLAVE_MENSAJE,
  PLANTILLA_DEFECTO,
  envInterruptor,
  limaDateTime,
  ventanaRecordatorio24h,
  seleccionarCitas24h,
  claveRecordatorio24h,
  mensajeRecordatorio24h,
  recordatorio24hActivo,
  procesarRecordatorios24h,
  ejecutarCronRecordatorios24h,
};
