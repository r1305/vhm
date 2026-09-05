const { Router } = require('express');
const pool = require('../lib/db');
const router = Router();

const t   = (v, max=255) => v == null ? null : String(v).trim().slice(0,max) || null;
const pid = v => { const n = parseInt(v,10); return isFinite(n) && n > 0 ? n : null; };

const TZ = 'America/Lima';

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

// GET /api/publico/:username/slots?mes=2025-08
router.get('/:username/slots', async (req, res) => {
  try {
    const [[ter]] = await pool.execute(
      'SELECT id, nombre, apellido, especialidad FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!ter) return res.status(404).json({ error: 'Terapeuta no encontrado' });

    const mesParam = t(req.query.mes, 7); // YYYY-MM
    const { fechaStr: hoyLima, minutos: minAhora } = ahoraLima();

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
      `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha, hora_inicio
       FROM citas WHERE terapeuta_id=? AND fecha BETWEEN ? AND ? AND estado NOT IN ('cancelada')`,
      [ter.id, desdeStr, hastaStr]
    );

    // Bloqueos en el rango
    const [bloqueos] = await pool.execute(
      'SELECT fecha_inicio, fecha_fin, hora_inicio, hora_fin FROM bloqueos WHERE terapeuta_id=? AND fecha_inicio<=? AND fecha_fin>=?',
      [ter.id, hastaStr, desdeStr]
    );

    const ocupados = {};
    citas.forEach(c => {
      const f = String(c.fecha).slice(0,10);
      if (!ocupados[f]) ocupados[f] = new Set();
      ocupados[f].add(toMin(c.hora_inicio));
    });

    const bloqueadoTotal = {};
    const bloqueadoParcial = {};
    bloqueos.forEach(b => {
      let d = new Date(String(b.fecha_inicio).slice(0,10) + 'T12:00:00');
      const fin = new Date(String(b.fecha_fin).slice(0,10) + 'T12:00:00');
      const bIni = toMin(b.hora_inicio);
      const bFin = toMin(b.hora_fin);
      const esTodoDia = bIni === 0 && bFin >= 23*60+59;
      while (d <= fin) {
        const f = isoDate(d);
        if (esTodoDia) { bloqueadoTotal[f] = true; }
        else {
          if (!bloqueadoParcial[f]) bloqueadoParcial[f] = [];
          bloqueadoParcial[f].push({ ini: bIni, fin: bFin });
        }
        d.setDate(d.getDate()+1);
      }
    });

    // Generar slots por día
    const dias = [];
    let cur = new Date(anio, mes, 1);
    while (isoDate(cur) <= hastaStr) {
      const f = isoDate(cur);
      const diaSemana = cur.getDay();
      const esPasado  = f < hoyLima;
      const esHoy     = f === hoyLima;
      const rangos    = horario[diaSemana];

      if (!rangos || esPasado || bloqueadoTotal[f]) {
        dias.push({ fecha: f, slots: [] });
        cur.setDate(cur.getDate()+1);
        continue;
      }

      const slots = [];
      for (const rango of rangos) {
        for (let m = rango.ini; m + 60 <= rango.fin; m += 60) {
          // Hoy: descartar slots cuya hora de inicio ya pasó en Lima
          if (esHoy && m <= minAhora) continue;
          if (ocupados[f]?.has(m)) continue;
          if ((bloqueadoParcial[f] || []).some(b => m < b.fin && m + 60 > b.ini)) continue;
          slots.push(minToHora(m));
        }
      }
      dias.push({ fecha: f, slots });
      cur.setDate(cur.getDate()+1);
    }

    res.json({ terapeuta: ter, dias, tz: TZ });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/publico/:username/agendar
router.post('/:username/agendar', async (req, res) => {
  try {
    const [[ter]] = await pool.execute(
      'SELECT id FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!ter) return res.status(404).json({ error: 'Terapeuta no encontrado' });

    const { nombre, apellido, email, telefono, fecha, hora_inicio, motivo } = req.body || {};
    if (!nombre || !fecha || !hora_inicio) return res.status(400).json({ error: 'nombre, fecha y hora_inicio requeridos' });

    // Verificar que el slot sigue libre
    const [[ocupado]] = await pool.execute(
      `SELECT id FROM citas WHERE terapeuta_id=? AND fecha=? AND hora_inicio=? AND estado NOT IN ('cancelada')`,
      [ter.id, fecha, hora_inicio + ':00']
    );
    if (ocupado) return res.status(409).json({ error: 'Este horario ya fue tomado, elige otro' });

    // Calcular hora_fin (+1h)
    const [hh, mm] = hora_inicio.split(':').map(Number);
    const hora_fin = `${String(hh+1).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;

    // Buscar paciente existente por email o teléfono
    let paciente = null;
    if (email) {
      const [[row]] = await pool.execute(
        'SELECT id, nombre, sesiones_disponibles FROM pacientes WHERE email=? LIMIT 1',
        [t(email, 150)]
      );
      paciente = row || null;
    }
    if (!paciente && telefono) {
      const [[row]] = await pool.execute(
        'SELECT id, nombre, sesiones_disponibles FROM pacientes WHERE telefono=? LIMIT 1',
        [t(telefono, 30)]
      );
      paciente = row || null;
    }

    let pacienteId;

    if (paciente) {
      // Paciente existente — verificar saldo
      if (paciente.sesiones_disponibles <= 0) {
        return res.status(403).json({
          error: 'No tienes sesiones disponibles para agendar. Contacta a tu terapeuta para adquirir más sesiones.',
          codigo: 'SIN_SESIONES',
        });
      }
      // Descontar 1 sesión
      await pool.execute(
        'UPDATE pacientes SET sesiones_disponibles = sesiones_disponibles - 1 WHERE id=?',
        [paciente.id]
      );
      pacienteId = paciente.id;
    } else {
      // Paciente nuevo — crear como prospecto asignado al terapeuta de la URL
      const [r] = await pool.execute(
        `INSERT INTO pacientes (nombre, apellido, email, telefono, fuente, estado, motivo_consulta, terapeuta_id)
         VALUES (?, ?, ?, ?, 'web', 'prospecto', ?, ?)`,
        [t(nombre,120), t(apellido,120), t(email,150), t(telefono,30), t(motivo,500), ter.id]
      );
      pacienteId = r.insertId;
    }

    const [rc] = await pool.execute(
      `INSERT INTO citas (paciente_id, terapeuta_id, fecha, hora_inicio, hora_fin, modalidad, tipo, estado)
       VALUES (?, ?, ?, ?, ?, 'presencial', 'primera_vez', 'pendiente')`,
      [pacienteId, ter.id, fecha, hora_inicio + ':00', hora_fin + ':00']
    );

    res.status(201).json({ ok: true, cita_id: rc.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

module.exports = router;
