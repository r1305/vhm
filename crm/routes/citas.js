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
    const mes   = t(req.query.mes, 7);
    const terapeuta = pid(req.query.terapeuta_id);
    const paciente  = pid(req.query.paciente_id);
    let sql = `SELECT c.*, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
               p.email AS paciente_email, p.telefono AS paciente_telefono,
               t.nombre AS terapeuta_nombre
               FROM citas c
               JOIN pacientes p ON c.paciente_id = p.id
               LEFT JOIN terapeutas t ON c.terapeuta_id = t.id
               WHERE 1=1`;
    const params = [];
    if (fecha) { sql += ' AND DATE(c.fecha) = ?'; params.push(fecha); }
    else if (mes) { sql += ' AND DATE_FORMAT(c.fecha, \'%Y-%m\') = ?'; params.push(mes); }
    if (terapeuta) { sql += ' AND c.terapeuta_id = ?'; params.push(terapeuta); }
    if (paciente)  { sql += ' AND c.paciente_id = ?';  params.push(paciente); }
    sql += of.sql; params.push(...of.params);
    sql += ' ORDER BY c.fecha DESC';
    if (!paciente) sql += ' LIMIT 2000';
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
    res.json(slots);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.post('/', auth, async (req, res) => {
  const { paciente_id, terapeuta_id, fecha, modalidad='presencial', tipo='seguimiento', estado='realizada', notas } = req.body || {};
  if (!paciente_id || !terapeuta_id || !fecha)
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  try {
    const [r] = await pool.execute(
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,modalidad,tipo,estado,notas)
       VALUES (?,?,?,?,?,?,?)`,
      [pid(paciente_id), pid(terapeuta_id), fecha, modalidad, tipo, estado, t(notas,2000)]
    );
    await pool.execute(
      `UPDATE pacientes SET estado='confirmado' WHERE id=? AND estado='prospecto'`,
      [pid(paciente_id)]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auto-agendamiento público (sin auth)
router.post('/agendar', async (req, res) => {
  const { nombre, apellido, email, telefono, terapeuta_id, fecha,
          modalidad='presencial', fuente_detalle } = req.body || {};
  if (!nombre || !terapeuta_id || !fecha)
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
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,modalidad,tipo)
       VALUES (?,?,?,?,'primera_vez')`,
      [pacienteId, pid(terapeuta_id), fecha, modalidad]
    );
    // Si el paciente es prospecto, pasa a confirmado
    await pool.execute(
      `UPDATE pacientes SET estado='confirmado' WHERE id=? AND estado='prospecto'`,
      [pacienteId]
    );
    res.status(201).json({ ok: true, cita_id: rc.insertId, paciente_id: pacienteId });
  } catch { res.status(500).json({ error: 'Error al agendar' }); }
});

router.delete('/:cid', auth, async (req, res) => {
  const cid = pid(req.params.cid);
  if (!cid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const [[cita]] = await pool.execute('SELECT estado, terapeuta_id FROM citas WHERE id=?', [cid]);
    if (!cita) return res.status(404).json({ error: 'No encontrada' });
    const esAdmin = req.user.rol !== 'terapeuta';
    if (!esAdmin && cita.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se pueden eliminar citas pendientes' });
    if (!esAdmin && cita.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    await pool.execute('DELETE FROM citas WHERE id=?', [cid]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:cid/estado', auth, async (req, res) => {
  const { estado, notas, fecha } = req.body || {};
  const sets = ['estado=?'];
  const vals = [estado];
  if (notas) { sets.push('notas=?'); vals.push(t(notas, 2000)); }
  if (fecha != null && fecha !== '') {
    if (req.user.rol === 'terapeuta') {
      return res.status(403).json({ error: 'Sin permiso para cambiar la fecha' });
    }
    const fechaVal = t(fecha, 10);
    if (!fechaVal || !/^\d{4}-\d{2}-\d{2}$/.test(fechaVal)) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }
    sets.push('fecha=?');
    vals.push(fechaVal);
  }
  vals.push(req.params.cid);
  await pool.execute(`UPDATE citas SET ${sets.join(',')} WHERE id=?`, vals);
  res.json({ ok: true });
});

// Enviar recordatorio manual
router.post('/:cid/recordatorio', auth, async (req, res) => {
  try {
    const canal = req.body?.canal || 'email';
    const [[cita]] = await pool.execute(
      `SELECT c.*, p.nombre, p.apellido, p.email, p.telefono,
              t.nombre AS t_nombre, t.apellido AS t_apellido
       FROM citas c JOIN pacientes p ON c.paciente_id=p.id
       JOIN terapeutas t ON c.terapeuta_id=t.id WHERE c.id=?`,
      [req.params.cid]
    );
    if (!cita) return res.status(404).json({ error: 'No encontrada' });
    const result = await sendRecordatorioCita(
      { nombre: cita.nombre, email: cita.email, telefono: cita.telefono },
      cita,
      { nombre: cita.t_nombre, apellido: cita.t_apellido },
      canal
    );
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
