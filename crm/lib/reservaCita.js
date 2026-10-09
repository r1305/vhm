const { evaluateBooking } = require('./paquetesPaciente');

const normHora = (v) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(v ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}` : null;
};

const sumarHora = (h) => {
  const [hh, mm, ss] = h.split(':').map(Number);
  return hh >= 23 ? null : `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const fechaValida = (f) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(new Date(f + 'T00:00:00-05:00'));

const diaSemanaLima = (f) => new Date(f + 'T12:00:00-05:00').getUTCDay();

const errorPublico = (status, message, extra) => Object.assign(new Error(message), extra || {}, { status, publico: true });

const cuerpoErrorPublico = (err) => {
  const body = { error: err.message };
  if (err.codigo) { body.codigo = err.codigo; body.cuota_numero = err.cuota_numero || null; }
  return body;
};

const MSG_NO_DISPONIBLE = 'Ese horario no está disponible';

const entero = (v, def) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : def; };
const VENTANA_MIN_HORAS = entero(process.env.VENTANA_MIN_HORAS, 24);
const VENTANA_MAX_DIAS = entero(process.env.VENTANA_MAX_DIAS, 15);
const MSG_FUERA_VENTANA = `Solo puedes agendar con al menos ${VENTANA_MIN_HORAS} horas de anticipación y hasta ${VENTANA_MAX_DIAS} días`;

const fechaLimaDe = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);

const sumarDiasFecha = (f, n) => {
  const d = new Date(f + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const instanteLima = (fecha, hora) => new Date(`${fecha}T${normHora(hora)}-05:00`);

function ventanaAgendamiento(ahora = new Date()) {
  const minMs = ahora.getTime() + VENTANA_MIN_HORAS * 3600000;
  return {
    minMs,
    minFecha: fechaLimaDe(new Date(minMs)),
    maxFecha: sumarDiasFecha(fechaLimaDe(ahora), VENTANA_MAX_DIAS),
  };
}

function dentroVentanaAgendamiento(fecha, hora, ahora = new Date()) {
  if (!fechaValida(fecha) || !normHora(hora)) return false;
  const v = ventanaAgendamiento(ahora);
  if (fecha > v.maxFecha) return false;
  const ini = instanteLima(fecha, hora).getTime();
  return Number.isFinite(ini) && ini >= v.minMs;
}

function validarVentanaAgendamiento(fecha, hora, ahora = new Date()) {
  if (!dentroVentanaAgendamiento(fecha, hora, ahora)) throw errorPublico(409, MSG_FUERA_VENTANA);
}

const horaAMin = (h) => {
  if (h == null) return 0;
  const p = String(h).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || 0, 10);
};

const fechaStrLima = (d) => {
  if (d instanceof Date) return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
  return String(d ?? '').slice(0, 10);
};

const FIN_DIA_MIN = 23 * 60 + 59;

function bloqueoSolapa(b, fecha, iniMin, finMin) {
  if (fecha < fechaStrLima(b.fecha_inicio) || fecha > fechaStrLima(b.fecha_fin)) return false;
  const bIni = horaAMin(b.hora_inicio);
  const bFin = horaAMin(b.hora_fin);
  if (bIni === 0 && bFin >= FIN_DIA_MIN) return true;
  return iniMin < bFin && finMin > bIni;
}

const franjaBloqueada = (bloqueos, fecha, iniMin, finMin) =>
  (bloqueos || []).some((b) => bloqueoSolapa(b, fecha, iniMin, finMin));

const encajaEnDisponibilidad = (rangos, iniMin, finMin) =>
  finMin > iniMin && (rangos || []).some((r) => horaAMin(r.hora_inicio) <= iniMin && finMin <= horaAMin(r.hora_fin));

const citaSolapa = (citas, iniMin, finMin) =>
  (citas || []).some((c) => c.hora_inicio != null && c.hora_fin != null
    && horaAMin(c.hora_inicio) < finMin && horaAMin(c.hora_fin) > iniMin);

async function bloquearPaciente(conn, pacienteId) {
  const [[row]] = await conn.execute('SELECT id FROM pacientes WHERE id=? FOR UPDATE', [pacienteId]);
  return row || null;
}

async function reservarCupoPaciente(conn, pacienteId) {
  if (!pacienteId || !(await bloquearPaciente(conn, pacienteId))) return null;
  const booking = await evaluateBooking(pacienteId, conn);
  if (!booking.ok) {
    throw errorPublico(403, booking.mensaje, {
      codigo: booking.codigo,
      cuota_numero: booking.cuota_numero || null,
    });
  }
  return { pacienteId, pacientePaqueteId: booking.paciente_paquete_id || null };
}

async function tipoCitaReserva(conn, pacienteId) {
  if (!pacienteId) return 'primera_vez';
  const [[previa]] = await conn.execute(
    "SELECT id FROM citas WHERE paciente_id=? AND estado <> 'cancelada' LIMIT 1",
    [pacienteId]
  );
  return previa ? 'seguimiento' : 'primera_vez';
}

/*
 * Orden de locks de toda reserva (POST /api/publico/:username/agendar y
 * POST /api/citas/agendar). Respetarlo en cualquier transacción nueva que
 * toque estas tablas para no provocar deadlocks:
 *   1. pacientes (id) FOR UPDATE           -> reservarCupoPaciente (bloquearPaciente), solo si ya existe
 *   2. paciente_paquetes del paciente      -> reservarCupoPaciente (evaluateBooking(pacienteId, conn))
 *   3. terapeutas (id) FOR UPDATE          -> bloquearFranja
 *   4. disponibilidad del día FOR UPDATE   -> bloquearFranja
 *   5. bloqueos del terapeuta LOCK IN SHARE MODE -> bloquearFranja
 *   6. citas solapadas FOR UPDATE          -> bloquearFranja
 *   7. INSERT pacientes (nuevo) / citas, UPDATE pacientes.estado
 */
async function bloquearFranja(conn, { terapeutaId, fecha, horaInicio, horaFin }) {
  const [[ter]] = await conn.execute(
    'SELECT id FROM terapeutas WHERE id=? AND activo=1 FOR UPDATE',
    [terapeutaId]
  );
  if (!ter) throw errorPublico(404, 'Terapeuta no encontrado');
  const iniMin = horaAMin(horaInicio);
  const finMin = horaAMin(horaFin);
  const [rangos] = await conn.execute(
    'SELECT hora_inicio, hora_fin FROM disponibilidad WHERE terapeuta_id=? AND dia_semana=? AND activo=1 FOR UPDATE',
    [terapeutaId, diaSemanaLima(fecha)]
  );
  if (!encajaEnDisponibilidad(rangos, iniMin, finMin)) throw errorPublico(409, MSG_NO_DISPONIBLE);
  const [bloqueos] = await conn.execute(
    `SELECT DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin,
            hora_inicio, hora_fin
     FROM bloqueos WHERE terapeuta_id=? AND fecha_inicio<=? AND fecha_fin>=?
     LOCK IN SHARE MODE`,
    [terapeutaId, fecha, fecha]
  );
  if (franjaBloqueada(bloqueos, fecha, iniMin, finMin)) throw errorPublico(409, MSG_NO_DISPONIBLE);
  const [[choque]] = await conn.execute(
    `SELECT id FROM citas
     WHERE terapeuta_id=? AND fecha=? AND estado <> 'cancelada'
       AND hora_inicio < ? AND hora_fin > ?
     LIMIT 1 FOR UPDATE`,
    [terapeutaId, fecha, horaFin, horaInicio]
  );
  if (choque) throw errorPublico(409, 'Ese horario ya no está disponible');
}

module.exports = {
  normHora, sumarHora, fechaValida, diaSemanaLima, errorPublico, cuerpoErrorPublico,
  horaAMin, bloqueoSolapa, franjaBloqueada, encajaEnDisponibilidad, citaSolapa,
  bloquearPaciente, reservarCupoPaciente, tipoCitaReserva, bloquearFranja,
  VENTANA_MIN_HORAS, VENTANA_MAX_DIAS, MSG_FUERA_VENTANA, MSG_NO_DISPONIBLE,
  fechaLimaDe, sumarDiasFecha, instanteLima, ventanaAgendamiento,
  dentroVentanaAgendamiento, validarVentanaAgendamiento,
};
