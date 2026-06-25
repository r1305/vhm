const { Router } = require('express');
const pool = require('../lib/db');
const { auth, ownerFilter } = require('../lib/auth');
const { sendRecordatorioCita } = require('../lib/mailer');

const router = Router();
const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const pid = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };

router.get('/', auth, async (req, res) => {
  try {
    const of = ownerFilter(req, 'c');
    const fecha = t(req.query.fecha, 10);
    const terapeuta = pid(req.query.terapeuta_id);
    let sql = `SELECT c.*, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
               p.email AS paciente_email, p.telefono AS paciente_telefono,
               t.nombre AS terapeuta_nombre
               FROM citas c
               JOIN pacientes p ON c.paciente_id = p.id
               JOIN terapeutas t ON c.terapeuta_id = t.id
               WHERE 1=1`;
    const params = [];
    if (fecha) { sql += ' AND c.fecha = ?'; params.push(fecha); }
    if (terapeuta) { sql += ' AND c.terapeuta_id = ?'; params.push(terapeuta); }
    sql += of.sql; params.push(...of.params);
    sql += ' ORDER BY c.fecha ASC, c.hora_inicio ASC LIMIT 300';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al listar citas' }); }
});

// Slots disponibles para auto-agendamiento público
router.get('/disponibles', async (req, res) => {
  const terapeuta_id = pid(req.query.terapeuta_id);
  const fecha = t(req.query.fecha, 10);
  if (!terapeuta_id || !fecha) return res.status(400).json({ error: 'terapeuta_id y fecha requeridos' });
  try {
    const d = new Date(fecha);
    const dia = (d.getDay() + 6) % 7; // 0=lun
    const [slots] = await pool.execute(
      'SELECT hora_inicio, hora_fin FROM disponibilidad WHERE terapeuta_id=? AND dia_semana=? AND activo=1',
      [terapeuta_id, dia]
    );
    const [ocupadas] = await pool.execute(
      "SELECT hora_inicio, hora_fin FROM citas WHERE terapeuta_id=? AND fecha=? AND estado NOT IN ('cancelada','no_show')",
      [terapeuta_id, fecha]
    );
    const ocupadasSet = new Set(ocupadas.map(c => c.hora_inicio.slice(0,5)));
    const libres = slots.filter(s => !ocupadasSet.has(s.hora_inicio.slice(0,5)));
    res.json(libres);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.post('/', auth, async (req, res) => {
  const { paciente_id, terapeuta_id, fecha, hora_inicio, hora_fin,
          modalidad='presencial', tipo='seguimiento', notas, monto } = req.body || {};
  if (!paciente_id || !terapeuta_id || !fecha || !hora_inicio || !hora_fin)
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  try {
    const [r] = await pool.execute(
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,hora_inicio,hora_fin,modalidad,tipo,notas,monto)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [pid(paciente_id),pid(terapeuta_id),fecha,hora_inicio,hora_fin,modalidad,tipo,t(notas,2000),monto||null]
    );
    // Programar recordatorios
    const citaId = r.insertId;
    const fecha48 = new Date(`${fecha}T${hora_inicio}`);
    fecha48.setHours(fecha48.getHours() - 48);
    const fecha24 = new Date(`${fecha}T${hora_inicio}`);
    fecha24.setHours(fecha24.getHours() - 24);
    await pool.execute(
      `INSERT INTO recordatorios (paciente_id,cita_id,tipo,canal,programado_at) VALUES (?,?,'recordatorio_cita','email',?)`,
      [pid(paciente_id), citaId, fecha48]
    );
    await pool.execute(
      `INSERT INTO recordatorios (paciente_id,cita_id,tipo,canal,programado_at) VALUES (?,?,'recordatorio_cita','email',?)`,
      [pid(paciente_id), citaId, fecha24]
    );
    res.status(201).json({ id: citaId });
  } catch { res.status(500).json({ error: 'Error al crear cita' }); }
});

// Auto-agendamiento público (sin auth)
router.post('/agendar', async (req, res) => {
  const { nombre, apellido, email, telefono, terapeuta_id, fecha,
          hora_inicio, hora_fin, modalidad='presencial', fuente_detalle } = req.body || {};
  if (!nombre || !terapeuta_id || !fecha || !hora_inicio)
    return res.status(400).json({ error: 'Datos incompletos' });
  try {
    // Crear o encontrar paciente
    let pacienteId;
    if (email) {
      const [[existing]] = await pool.execute('SELECT id FROM pacientes WHERE email=? LIMIT 1', [email]);
      pacienteId = existing?.id;
    }
    if (!pacienteId) {
      const [r] = await pool.execute(
        `INSERT INTO pacientes (nombre,apellido,email,telefono,fuente,fuente_detalle,estado)
         VALUES (?,?,?,?,'web',?,'prospecto')`,
        [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),t(fuente_detalle,300)]
      );
      pacienteId = r.insertId;
    }
    const [rc] = await pool.execute(
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,hora_inicio,hora_fin,modalidad,tipo)
       VALUES (?,?,?,?,?,?,'primera_vez')`,
      [pacienteId, pid(terapeuta_id), fecha, hora_inicio, hora_fin||'', modalidad]
    );
    res.status(201).json({ ok: true, cita_id: rc.insertId, paciente_id: pacienteId });
  } catch { res.status(500).json({ error: 'Error al agendar' }); }
});

router.patch('/:cid/estado', auth, async (req, res) => {
  const { estado } = req.body || {};
  await pool.execute('UPDATE citas SET estado=? WHERE id=?', [estado, req.params.cid]);
  res.json({ ok: true });
});

// Enviar recordatorio manual
router.post('/:cid/recordatorio', auth, async (req, res) => {
  try {
    const [[cita]] = await pool.execute(
      `SELECT c.*, p.nombre, p.apellido, p.email,
              t.nombre AS t_nombre, t.apellido AS t_apellido
       FROM citas c JOIN pacientes p ON c.paciente_id=p.id
       JOIN terapeutas t ON c.terapeuta_id=t.id WHERE c.id=?`,
      [req.params.cid]
    );
    if (!cita) return res.status(404).json({ error: 'No encontrada' });
    await sendRecordatorioCita(
      { nombre: cita.nombre, email: cita.email },
      cita,
      { nombre: cita.t_nombre, apellido: cita.t_apellido }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
