const { Router } = require('express');
const pool = require('../lib/db');
const { createMeetLink, isConnected } = require('../lib/googleMeet');
const googleCal = require('../lib/googleCalendar');
const {
  normHora, sumarHora, fechaValida, diaSemanaLima, cuerpoErrorPublico,
  franjaBloqueada, citaSolapa, reservarCupoPaciente, tipoCitaReserva, bloquearFranja,
  ventanaAgendamiento, dentroVentanaAgendamiento, validarVentanaAgendamiento,
} = require('../lib/reservaCita');
const router = Router();

const t   = (v, max=255) => v == null ? null : String(v).trim().slice(0,max) || null;
const pid = v => { const n = parseInt(v,10); return isFinite(n) && n > 0 ? n : null; };

const TZ = 'America/Lima';
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DIAS_SLOTS = 62;

// Fecha y hora actuales en America/Lima
function ahoraLima() {
  // Devuelve { fechaStr: 'YYYY-MM-DD', minutos: N } en Lima
  const now = new Date();
  const limaStr = now.toLocaleString('en-CA', { timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' });
  // en-CA da 'YYYY-MM-DD, HH:MM'
  const [fechaPart, horaPart] = limaStr.split(', ');
  const [hh, mm] = horaPart.split(':').map(Number);
  return { fechaStr: fechaPart.trim(), minutos: hh * 60 + mm };
}

// GET /api/publico/:username/buscar-paciente?email=&telefono=
// Devuelve nombre/apellido si el paciente existe (sin exponer datos sensibles)
router.get('/:username/buscar-paciente', async (req, res) => {
  try {
    const { email, telefono } = req.query;
    if (!email && !telefono) return res.json({ encontrado: false });

    let paciente = null;
    if (email) {
      const [[row]] = await pool.execute(
        'SELECT nombre, apellido, email FROM pacientes WHERE email=? LIMIT 1',
        [t(email, 150)]
      );
      paciente = row || null;
    }
    if (!paciente && telefono) {
      const [[row]] = await pool.execute(
        'SELECT nombre, apellido, email FROM pacientes WHERE telefono=? LIMIT 1',
        [t(telefono, 30)]
      );
      paciente = row || null;
    }

    if (paciente) return res.json({ encontrado: true, nombre: paciente.nombre, apellido: paciente.apellido || '', email: paciente.email || '' });
    res.json({ encontrado: false });
  } catch (err) {
    console.error('[publico/buscar-paciente] username=%s:', req.params.username, err);
    res.status(500).json({ error: 'No se pudo buscar el paciente. Inténtalo nuevamente.' });
  }
});

// GET /api/publico/:username/slots?mes=2025-08
router.get('/:username/slots', async (req, res) => {
  try {
    const [[ter]] = await pool.execute(
      'SELECT id, nombre, apellido, especialidad, presencial_habilitado FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!ter) return res.status(404).json({ error: 'Terapeuta no encontrado' });

    const mesParam = req.query.mes == null || req.query.mes === '' ? null : String(req.query.mes);
    if (mesParam !== null && !MES_RE.test(mesParam)) return res.status(400).json({ error: 'Mes inválido' });
    const { fechaStr: hoyLima } = ahoraLima();
    const ahora = new Date();
    const ventana = ventanaAgendamiento(ahora);

    const anio = mesParam ? parseInt(mesParam.split('-')[0]) : parseInt(hoyLima.slice(0,4));
    const mes  = mesParam ? parseInt(mesParam.split('-')[1]) - 1 : parseInt(hoyLima.slice(5,7)) - 1;

    const desde = new Date(anio, mes, 1);
    const hasta = new Date(anio, mes + 1, 0);
    const desdeStr = isoDate(desde);
    const hastaStr = isoDate(hasta);

    // Horario de trabajo del terapeuta — puede haber múltiples rangos por día
    const [disponibilidad] = await pool.execute(
      'SELECT dia_semana, hora_inicio, hora_fin FROM disponibilidad WHERE terapeuta_id=? AND activo=1 ORDER BY dia_semana, hora_inicio',
      [ter.id]
    );
    // Mapa dia_semana -> [{ini, fin}] en minutos
    const horario = {};
    disponibilidad.forEach(d => {
      if (!horario[d.dia_semana]) horario[d.dia_semana] = [];
      horario[d.dia_semana].push({ ini: toMin(d.hora_inicio), fin: toMin(d.hora_fin) });
    });

    // Citas existentes en el rango
    const [citas] = await pool.execute(
      `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha, hora_inicio, hora_fin
       FROM citas WHERE terapeuta_id=? AND fecha BETWEEN ? AND ? AND estado NOT IN ('cancelada')`,
      [ter.id, desdeStr, hastaStr]
    );

    // Bloqueos en el rango (CRM)
    const [bloqueos] = await pool.execute(
      `SELECT DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin,
              hora_inicio, hora_fin
       FROM bloqueos WHERE terapeuta_id=? AND fecha_inicio<=? AND fecha_fin>=?`,
      [ter.id, hastaStr, desdeStr]
    );

    // Bloqueos de Google Calendar
    let gcalBusy = [];
    try {
      if (await googleCal.isConnected(ter.id)) {
        gcalBusy = await googleCal.getBusySlots(ter.id, desdeStr, hastaStr);
      }
    } catch (_) {}

    const ocupados = {};
    citas.forEach(c => {
      const f = String(c.fecha).slice(0,10);
      if (!ocupados[f]) ocupados[f] = [];
      ocupados[f].push(c);
    });

    // Generar slots por día
    const dias = [];
    let cur = new Date(anio, mes, 1);
    for (let iter = 0; iter < MAX_DIAS_SLOTS && isoDate(cur) <= hastaStr; iter++) {
      const f = isoDate(cur);
      const diaSemana = diaSemanaLima(f);
      const fueraVentana = f < ventana.minFecha || f > ventana.maxFecha;
      const rangos    = horario[diaSemana];

      if (!rangos || fueraVentana) {
        dias.push({ fecha: f, slots: [] });
        cur.setDate(cur.getDate()+1);
        continue;
      }

      // Busy slots de GCal para este día (convertir a minutos Lima)
      const gcalBusyHoy = gcalBusy
        .filter(b => String(b.start).slice(0,10) === f || String(b.end).slice(0,10) === f)
        .map(b => ({
          ini: limaMin(new Date(b.start)),
          fin: limaMin(new Date(b.end)),
        }));

      const slots = [];
      for (const rango of rangos) {
        for (let m = rango.ini; m + 60 <= rango.fin; m += 60) {
          if (!dentroVentanaAgendamiento(f, minToHora(m), ahora)) continue;
          if (citaSolapa(ocupados[f], m, m + 60)) continue;
          if (franjaBloqueada(bloqueos, f, m, m + 60)) continue;
          if (gcalBusyHoy.some(b => m < b.fin && m + 60 > b.ini)) continue;
          slots.push(minToHora(m));
        }
      }
      dias.push({ fecha: f, slots });
      cur.setDate(cur.getDate()+1);
    }

    res.json({
      terapeuta: {
        ...ter,
        presencial_habilitado: !!ter.presencial_habilitado,
      },
      dias,
      tz: TZ,
      ventana: { min_fecha: ventana.minFecha, max_fecha: ventana.maxFecha },
    });
  } catch (err) {
    console.error('[publico/slots] username=%s mes=%s:', req.params.username, req.query.mes, err);
    res.status(500).json({ error: 'No se pudieron cargar los horarios. Inténtalo nuevamente.' });
  }
});

// POST /api/publico/:username/agendar
router.post('/:username/agendar', async (req, res) => {
  let conn;
  let ter;
  const { nombre, apellido, email, telefono, fecha, hora_inicio, motivo, modalidad } = req.body || {};
  const fechaVal = t(fecha, 10);
  const horaInicio = normHora(hora_inicio);
  try {
    [[ter]] = await pool.execute(
      'SELECT id, presencial_habilitado FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!ter) return res.status(404).json({ error: 'Terapeuta no encontrado' });

    if (!nombre || !fecha || !hora_inicio) return res.status(400).json({ error: 'nombre, fecha y hora_inicio requeridos' });
    if (!fechaValida(fechaVal)) return res.status(400).json({ error: 'Fecha inválida' });
    if (!horaInicio) return res.status(400).json({ error: 'Hora inválida' });
    const horaFin = sumarHora(horaInicio);
    if (!horaFin) return res.status(400).json({ error: 'Horario inválido' });
    validarVentanaAgendamiento(fechaVal, horaInicio);
    const presencialOk = !!ter.presencial_habilitado;
    let modalidadVal = ['presencial', 'videollamada', 'telefono'].includes(modalidad) ? modalidad : 'videollamada';
    if (modalidadVal === 'presencial' && !presencialOk) {
      return res.status(400).json({ error: 'Este terapeuta no ofrece atención presencial' });
    }

    // Validar contra Google Calendar
    try {
      if (await googleCal.isConnected(ter.id)) {
        const slotIni = toMin(horaInicio);
        const slotFin = toMin(horaFin);
        const busy = await googleCal.getBusySlots(ter.id, fechaVal, fechaVal);
        const bloqueado = busy.some(b => {
          const bIni = limaMin(new Date(b.start));
          const bFin = limaMin(new Date(b.end));
          return slotIni < bFin && slotFin > bIni;
        });
        if (bloqueado) return res.status(409).json({ error: 'Este horario no está disponible, elige otro' });
      }
    } catch (_) {}

    // Buscar paciente existente por email o teléfono
    let paciente = null;
    if (email) {
      const [[row]] = await pool.execute(
        'SELECT p.id, p.nombre FROM pacientes p WHERE p.email=? LIMIT 1',
        [t(email, 150)]
      );
      paciente = row || null;
    }
    if (!paciente && telefono) {
      const [[row]] = await pool.execute(
        'SELECT p.id, p.nombre FROM pacientes p WHERE p.telefono=? LIMIT 1',
        [t(telefono, 30)]
      );
      paciente = row || null;
    }

    let pacienteId = null;
    let pacientePaqueteId = null;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const cupo = paciente ? await reservarCupoPaciente(conn, paciente.id) : null;
    if (cupo) {
      pacienteId = cupo.pacienteId;
      pacientePaqueteId = cupo.pacientePaqueteId;
    }

    await bloquearFranja(conn, { terapeutaId: ter.id, fecha: fechaVal, horaInicio, horaFin });
    const tipoCita = await tipoCitaReserva(conn, pacienteId);

    if (!pacienteId) {
      // Paciente nuevo — crear como prospecto asignado al terapeuta de la URL
      const [r] = await conn.execute(
        `INSERT INTO pacientes (nombre, apellido, email, telefono, fuente, estado, motivo_consulta, terapeuta_id)
         VALUES (?, ?, ?, ?, 'web', 'prospecto', ?, ?)`,
        [t(nombre,120), t(apellido,120), t(email,150), t(telefono,30), t(motivo,500), ter.id]
      );
      pacienteId = r.insertId;
    }

    const [rc] = await conn.execute(
      `INSERT INTO citas (paciente_id, terapeuta_id, fecha, hora_inicio, hora_fin, modalidad, tipo, estado, meet_link, paciente_paquete_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', NULL, ?)`,
      [pacienteId, ter.id, fechaVal, horaInicio, horaFin, modalidadVal, tipoCita, pacientePaqueteId]
    );
    await conn.commit();
    conn.release();
    conn = null;

    // Generar Meet link si es videollamada (fuera de la transacción)
    let meet_link = null;
    if (modalidadVal === 'videollamada' && await isConnected().catch(() => false)) {
      meet_link = await createMeetLink({
        titulo: `Sesión VHM — ${t(nombre,120)}`,
        fecha: fechaVal, horaInicio: horaInicio.slice(0, 5), horaFin: horaFin.slice(0, 5),
      }).catch(e => { console.error('[meet]', e.message); return null; });
      if (meet_link) {
        await pool.execute('UPDATE citas SET meet_link=? WHERE id=?', [meet_link, rc.insertId])
          .catch(e => console.error('[publico/agendar] meet_link cita=%s:', rc.insertId, e));
      }
    }

    res.status(201).json({ ok: true, cita_id: rc.insertId, meet_link });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    if (err.publico) return res.status(err.status).json(cuerpoErrorPublico(err));
    console.error('[publico/agendar] username=%s terapeuta_id=%s fecha=%s hora=%s:',
      req.params.username, ter?.id, fechaVal, horaInicio, err);
    res.status(500).json({ error: 'No se pudo agendar la cita. Inténtalo nuevamente.' });
  } finally {
    if (conn) conn.release();
  }
});

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function toMin(t) {
  if (!t) return 0;
  const p = String(t).split(':');
  return parseInt(p[0],10)*60 + parseInt(p[1]||0,10);
}
function minToHora(m) {
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
}
// Convierte un Date a minutos del día en zona America/Lima
function limaMin(date) {
  const str = date.toLocaleString('en-US', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

module.exports = router;
