const { Router } = require('express');
const pool = require('../lib/db');
const router = Router();

const t   = (v, max=255) => v == null ? null : String(v).trim().slice(0,max) || null;
const pid = v => { const n = parseInt(v,10); return isFinite(n) && n > 0 ? n : null; };

// GET /api/publico/:username/slots?mes=2025-08
// Devuelve por cada día del mes: slots libres de 1h dentro del horario del terapeuta
router.get('/:username/slots', async (req, res) => {
  try {
    const [[ter]] = await pool.execute(
      'SELECT id, nombre, apellido, especialidad FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!ter) return res.status(404).json({ error: 'Terapeuta no encontrado' });

    const mesParam = t(req.query.mes, 7); // YYYY-MM
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const anio = mesParam ? parseInt(mesParam.split('-')[0]) : hoy.getFullYear();
    const mes  = mesParam ? parseInt(mesParam.split('-')[1]) - 1 : hoy.getMonth();

    const desde = new Date(anio, mes, 1);
    const hasta = new Date(anio, mes + 1, 0);
    const desdeStr = isoDate(desde);
    const hastaStr = isoDate(hasta);

    // Horario de trabajo del terapeuta (por dia_semana)
    const [disponibilidad] = await pool.execute(
      'SELECT dia_semana, hora_inicio, hora_fin FROM disponibilidad WHERE terapeuta_id=? AND activo=1',
      [ter.id]
    );
    // Mapa dia_semana(0=dom..6=sab) -> {inicio, fin} en minutos
    const horario = {};
    disponibilidad.forEach(d => {
      horario[d.dia_semana] = { ini: toMin(d.hora_inicio), fin: toMin(d.hora_fin) };
    });

    // Citas existentes en el rango
    const [citas] = await pool.execute(
      `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha, hora_inicio, hora_fin
       FROM citas WHERE terapeuta_id=? AND fecha BETWEEN ? AND ? AND estado NOT IN ('cancelada')`,
      [ter.id, desdeStr, hastaStr]
    );

    // Bloqueos en el rango
    const [bloqueos] = await pool.execute(
      'SELECT fecha_inicio, fecha_fin, hora_inicio, hora_fin FROM bloqueos WHERE terapeuta_id=? AND fecha_inicio<=? AND fecha_fin>=?',
      [ter.id, hastaStr, desdeStr]
    );

    // Construir mapa de slots ocupados por fecha
    const ocupados = {}; // fecha -> Set de minutos de inicio ocupados
    citas.forEach(c => {
      const f = String(c.fecha).slice(0,10);
      if (!ocupados[f]) ocupados[f] = new Set();
      ocupados[f].add(toMin(c.hora_inicio));
    });

    // Expandir bloqueos a fechas individuales
    const bloqueadoTotal = {}; // fecha -> bool (todo el dia)
    const bloqueadoParcial = {}; // fecha -> [{ini,fin}]
    bloqueos.forEach(b => {
      let d = new Date(String(b.fecha_inicio).slice(0,10) + 'T12:00:00');
      const fin = new Date(String(b.fecha_fin).slice(0,10) + 'T12:00:00');
      const bIni = toMin(b.hora_inicio);
      const bFin = toMin(b.hora_fin);
      const esTodoDia = bIni === 0 && bFin >= 23*60+59;
      while (d <= fin) {
        const f = isoDate(d);
        if (esTodoDia) {
          bloqueadoTotal[f] = true;
        } else {
          if (!bloqueadoParcial[f]) bloqueadoParcial[f] = [];
          bloqueadoParcial[f].push({ ini: bIni, fin: bFin });
        }
        d.setDate(d.getDate()+1);
      }
    });

    // Generar slots por día
    const dias = [];
    let cur = new Date(desde);
    while (cur <= hasta) {
      const f = isoDate(cur);
      const diaSemana = cur.getDay(); // 0=dom
      const esHoyOAntes = cur < hoy;
      const h = horario[diaSemana];

      if (!h || esHoyOAntes || bloqueadoTotal[f]) {
        dias.push({ fecha: f, slots: [] });
        cur.setDate(cur.getDate()+1);
        continue;
      }

      const slots = [];
      for (let m = h.ini; m + 60 <= h.fin; m += 60) {
        // Verificar si el slot está ocupado por cita
        const citaOcupa = ocupados[f]?.has(m);
        // Verificar si el slot está bloqueado parcialmente
        const bloqOcupa = (bloqueadoParcial[f] || []).some(b => m < b.fin && m + 60 > b.ini);
        if (!citaOcupa && !bloqOcupa) {
          slots.push(minToHora(m));
        }
      }
      dias.push({ fecha: f, slots });
      cur.setDate(cur.getDate()+1);
    }

    res.json({ terapeuta: ter, dias });
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

    // Crear o encontrar paciente
    let pacienteId;
    if (email) {
      const [[existing]] = await pool.execute('SELECT id FROM pacientes WHERE email=? LIMIT 1', [email]);
      pacienteId = existing?.id;
    }
    if (!pacienteId && telefono) {
      const [[existing]] = await pool.execute('SELECT id FROM pacientes WHERE telefono=? LIMIT 1', [telefono]);
      pacienteId = existing?.id;
    }
    if (!pacienteId) {
      const [r] = await pool.execute(
        `INSERT INTO pacientes (nombre,apellido,email,telefono,fuente,estado,motivo_consulta)
         VALUES (?,?,?,?,'web','prospecto',?)`,
        [t(nombre,120), t(apellido,120), t(email,150), t(telefono,30), t(motivo,500)]
      );
      pacienteId = r.insertId;
    }

    const [rc] = await pool.execute(
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,hora_inicio,hora_fin,modalidad,tipo,estado)
       VALUES (?,?,?,?,?,'presencial','primera_vez','pendiente')`,
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
