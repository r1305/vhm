const { Router } = require('express');
const pool = require('../lib/db');
const { ownerFilter, ocultarMontosCitas } = require('../lib/auth');
const { isStaffAdmin } = require('../lib/roles');
const { puedeVerPaciente } = require('./pacientes');
const { requireMenuPermisoApi } = require('../lib/menuPermisos');
const { sendRecordatorioCita } = require('../lib/mailer');
const { createMeetLink, isConnected } = require('../lib/googleMeet');
const { getActivePacientePaquete } = require('../lib/paquetesPaciente');
const googleCal = require('../lib/googleCalendar');
const {
  normHora, sumarHora, fechaValida, diaSemanaLima, cuerpoErrorPublico,
  reservarCupoPaciente, tipoCitaReserva, bloquearFranja,
  dentroVentanaAgendamiento, MSG_FUERA_VENTANA,
} = require('../lib/reservaCita');

const router = Router();
const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const pid = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };

router.get('/', requireMenuPermisoApi('agenda', 'calendario', 'mi_reporte'), async (req, res) => {
  try {
    const of = ownerFilter(req, 'c');
    const fecha  = t(req.query.fecha, 10);
    const mes    = t(req.query.mes, 7);
    const desde  = t(req.query.desde, 10);
    const hasta  = t(req.query.hasta, 10);
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
    if (desde && hasta) { sql += ' AND c.fecha BETWEEN ? AND ?'; params.push(desde, hasta); }
    else if (fecha) { sql += ' AND DATE(c.fecha) = ?'; params.push(fecha); }
    else if (mes) { sql += ' AND DATE_FORMAT(c.fecha, \'%Y-%m\') = ?'; params.push(mes); }
    if (terapeuta) { sql += ' AND c.terapeuta_id = ?'; params.push(terapeuta); }
    if (paciente)  { sql += ' AND c.paciente_id = ?';  params.push(paciente); }
    sql += of.sql; params.push(...of.params);
    sql += ' ORDER BY c.fecha DESC';
    if (!paciente) sql += ' LIMIT 2000';
    const [rows] = await pool.execute(sql, params);
    res.json(ocultarMontosCitas(req, rows));
  } catch { res.status(500).json({ error: 'Error al listar citas' }); }
});

// Slots disponibles para auto-agendamiento público
router.get('/disponibles', async (req, res) => {
  const terapeuta_id = pid(req.query.terapeuta_id);
  const fecha = t(req.query.fecha, 10);
  if (!terapeuta_id || !fecha) return res.status(400).json({ error: 'terapeuta_id y fecha requeridos' });
  if (!fechaValida(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
  try {
    const dia = diaSemanaLima(fecha);
    const [slots] = await pool.execute(
      'SELECT hora_inicio, hora_fin FROM disponibilidad WHERE terapeuta_id=? AND dia_semana=? AND activo=1',
      [terapeuta_id, dia]
    );

    // Cruzar con Google Calendar si el terapeuta tiene cuenta vinculada
    let busySlots = [];
    try {
      const connected = await googleCal.isConnected(terapeuta_id);
      if (connected) {
        busySlots = await googleCal.getBusySlots(terapeuta_id, fecha, fecha);
      }
    } catch (_) {}

    res.json({ slots, busySlots });
  } catch { res.status(500).json({ error: 'Error' }); }
});

function gcalTitulo(pac, tipo) {
  const TIPO = { primera_vez: 'Primera consulta', seguimiento: 'Sesión', evaluacion: 'Evaluación', urgencia: 'Urgencia' };
  return `${TIPO[tipo] || 'Sesión'}${pac ? ' — ' + pac.nombre + ' ' + pac.apellido : ''}`;
}

router.post('/', requireMenuPermisoApi('agenda', 'calendario'), async (req, res) => {
  const { paciente_id, terapeuta_id, fecha, modalidad='presencial', tipo='seguimiento', estado='pendiente', notas } = req.body || {};
  let { hora_inicio, hora_fin } = req.body || {};
  if (!paciente_id || !terapeuta_id || !fecha)
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  const staff = isStaffAdmin(req.user.rol);
  if (!staff && pid(terapeuta_id) !== req.user.id)
    return res.status(403).json({ error: 'Solo puedes crear citas propias' });
  const fechaVal = t(fecha, 10);
  if (!fechaValida(fechaVal)) return res.status(400).json({ error: 'Fecha inválida' });
  const horaIniNorm = normHora(hora_inicio || '17:00');
  const horaFinNorm = normHora(hora_fin || '18:00');
  if (!horaIniNorm) return res.status(400).json({ error: 'Hora de inicio inválida' });
  if (!horaFinNorm) return res.status(400).json({ error: 'Hora de fin inválida' });
  hora_inicio = horaIniNorm.slice(0, 5);
  hora_fin    = horaFinNorm.slice(0, 5);
  if (hora_fin <= hora_inicio) return res.status(400).json({ error: 'Horario inválido' });
  try {
    if (!staff && !(pid(paciente_id) && await puedeVerPaciente(req, pid(paciente_id))))
      return res.status(403).json({ error: 'Sin acceso al paciente' });
    const terapeutaConGcal = await googleCal.isConnected(pid(terapeuta_id)).catch(() => false);
    let meet_link = null;
    // Si el terapeuta NO tiene GCal, usar cuenta global como fallback para Meet
    if (modalidad === 'videollamada' && !terapeutaConGcal && await isConnected().catch(() => false)) {
      const [[pac]] = await pool.execute('SELECT nombre, apellido FROM pacientes WHERE id=?', [pid(paciente_id)]);
      meet_link = await createMeetLink({
        titulo: `Sesión VHM${pac ? ' — ' + pac.nombre + ' ' + pac.apellido : ''}`,
        fecha: fechaVal, horaInicio: hora_inicio, horaFin: hora_fin,
      }).catch(e => { console.error('[meet]', googleCal.detalleErrorGoogle(e)); return null; });
    }
    const paqueteActivo = await getActivePacientePaquete(pid(paciente_id)).catch(() => null);
    const pacientePaqueteId = paqueteActivo?.id || null;
    const [r] = await pool.execute(
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,hora_inicio,hora_fin,modalidad,tipo,estado,notas,meet_link,paciente_paquete_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [pid(paciente_id), pid(terapeuta_id), fechaVal, hora_inicio, hora_fin, modalidad, tipo, estado, t(notas,2000), meet_link, pacientePaqueteId]
    );
    await pool.execute(
      `UPDATE pacientes SET estado='confirmado' WHERE id=? AND estado='prospecto'`,
      [pid(paciente_id)]
    );
    let gcal_event_id = null;
    try {
      if (terapeutaConGcal) {
        const [[pac]] = await pool.execute('SELECT nombre, apellido FROM pacientes WHERE id=?', [pid(paciente_id)]);
        const withMeet = modalidad === 'videollamada';
        const result = await googleCal.createEvent(pid(terapeuta_id), {
          titulo: gcalTitulo(pac, tipo),
          fecha: fechaVal, horaInicio: hora_inicio, horaFin: hora_fin,
          descripcion: `Modalidad: ${modalidad}${notas ? '\n' + notas : ''}`,
          withMeet,
        });
        gcal_event_id = result.gcalEventId;
        if (withMeet && result.meetLink) meet_link = result.meetLink;
        if (gcal_event_id) await pool.execute('UPDATE citas SET gcal_event_id=?, meet_link=? WHERE id=?', [gcal_event_id, meet_link, r.insertId]);
      }
    } catch (e) { console.error('[gcal create]', googleCal.detalleErrorGoogle(e)); }
    res.status(201).json({ id: r.insertId, meet_link, gcal_event_id });
  } catch (err) {
    console.error('[citas/crear] paciente_id=%s terapeuta_id=%s fecha=%s:', paciente_id, terapeuta_id, fecha, err);
    res.status(500).json({ error: 'No se pudo crear la cita. Inténtalo nuevamente.' });
  }
});

// Auto-agendamiento público (sin auth)
router.post('/agendar', async (req, res) => {
  const { nombre, apellido, email, telefono, terapeuta_id, fecha,
          modalidad='presencial', fuente_detalle } = req.body || {};
  if (!nombre || !terapeuta_id || !fecha)
    return res.status(400).json({ error: 'Datos incompletos' });
  const terapeutaId = pid(terapeuta_id);
  const fechaVal = t(fecha, 10);
  const { hora_inicio, hora_fin } = req.body;
  const horaInicio = hora_inicio ? normHora(hora_inicio) : '17:00:00';
  const horaFin = hora_fin ? normHora(hora_fin) : (horaInicio && sumarHora(horaInicio));
  if (!terapeutaId) return res.status(400).json({ error: 'Terapeuta inválido' });
  if (!horaInicio) return res.status(400).json({ error: 'Hora inválida' });
  if (!fechaValida(fechaVal))
    return res.status(400).json({ error: 'Fecha inválida' });
  if (!horaFin || horaFin <= horaInicio)
    return res.status(400).json({ error: 'Horario inválido' });
  if (!['presencial', 'videollamada', 'telefono'].includes(modalidad))
    return res.status(400).json({ error: 'Modalidad inválida' });
  if (!dentroVentanaAgendamiento(fechaVal, horaInicio))
    return res.status(409).json({ error: MSG_FUERA_VENTANA });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    let pacienteId = null;
    let pacientePaqueteId = null;
    const emailVal = t(email, 150);
    if (emailVal) {
      const [[existing]] = await conn.execute('SELECT id FROM pacientes WHERE email=? LIMIT 1', [emailVal]);
      const cupo = existing ? await reservarCupoPaciente(conn, existing.id) : null;
      if (cupo) {
        pacienteId = cupo.pacienteId;
        pacientePaqueteId = cupo.pacientePaqueteId;
      }
    }
    await bloquearFranja(conn, { terapeutaId, fecha: fechaVal, horaInicio, horaFin });
    const tipoCita = await tipoCitaReserva(conn, pacienteId);
    if (!pacienteId) {
      const [r] = await conn.execute(
        `INSERT INTO pacientes (nombre,apellido,email,telefono,fuente,fuente_detalle,estado)
         VALUES (?,?,?,?,'web',?,'prospecto')`,
        [t(nombre,120),t(apellido,120),emailVal,t(telefono,30),t(fuente_detalle,300)]
      );
      pacienteId = r.insertId;
    }
    const [rc] = await conn.execute(
      `INSERT INTO citas (paciente_id,terapeuta_id,fecha,hora_inicio,hora_fin,modalidad,tipo,paciente_paquete_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [pacienteId, terapeutaId, fechaVal, horaInicio, horaFin, modalidad, tipoCita, pacientePaqueteId]
    );
    // Si el paciente es prospecto, pasa a confirmado
    await conn.execute(
      `UPDATE pacientes SET estado='confirmado' WHERE id=? AND estado='prospecto'`,
      [pacienteId]
    );
    await conn.commit();
    res.status(201).json({ ok: true, cita_id: rc.insertId, paciente_id: pacienteId });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    if (err.publico) return res.status(err.status).json(cuerpoErrorPublico(err));
    console.error('[citas/agendar] terapeuta_id=%s fecha=%s hora=%s:', terapeutaId, fechaVal, horaInicio, err);
    res.status(500).json({ error: 'No se pudo agendar la cita. Inténtalo nuevamente.' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:cid', requireMenuPermisoApi('agenda', 'calendario'), async (req, res) => {
  const cid = pid(req.params.cid);
  if (!cid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const [[cita]] = await pool.execute('SELECT estado, terapeuta_id, gcal_event_id FROM citas WHERE id=?', [cid]);
    if (!cita) return res.status(404).json({ error: 'No encontrada' });
    const esAdmin = isStaffAdmin(req.user.rol);
    if (!esAdmin && cita.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se pueden eliminar citas pendientes' });
    if (!esAdmin && cita.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    if (cita.gcal_event_id) {
      try { await googleCal.deleteEvent(cita.terapeuta_id, cita.gcal_event_id); } catch (e) { console.error('[gcal delete]', googleCal.detalleErrorGoogle(e)); }
    }
    await pool.execute('DELETE FROM citas WHERE id=?', [cid]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[citas/eliminar] cita_id=%s:', cid, err);
    res.status(500).json({ error: 'No se pudo eliminar la cita. Inténtalo nuevamente.' });
  }
});

router.put('/:cid', requireMenuPermisoApi('agenda', 'calendario'), async (req, res) => {
  const cid = pid(req.params.cid);
  if (!cid) return res.status(400).json({ error: 'ID inválido' });
  const { fecha, hora_inicio, hora_fin, modalidad, tipo, estado, notas } = req.body || {};
  try {
    const [[cita]] = await pool.execute("SELECT *, DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha_ymd FROM citas WHERE id=?", [cid]);
    if (!cita) return res.status(404).json({ error: 'No encontrada' });
    const esAdmin = isStaffAdmin(req.user.rol);
    if (!esAdmin && cita.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    const updates = {};
    if (fecha != null && fecha !== '') {
      const fechaVal = t(fecha, 10);
      if (!fechaValida(fechaVal))
        return res.status(400).json({ error: 'Fecha inválida' });
      updates.fecha = fechaVal;
    }
    const vacio = (v) => v == null || String(v).trim() === '';
    if (!vacio(hora_inicio)) {
      const hIni = normHora(hora_inicio);
      if (!hIni) return res.status(400).json({ error: 'Hora de inicio inválida' });
      updates.hora_inicio = hIni.slice(0, 5);
    }
    if (!vacio(hora_fin)) {
      const hFin = normHora(hora_fin);
      if (!hFin) return res.status(400).json({ error: 'Hora de fin inválida' });
      updates.hora_fin = hFin.slice(0, 5);
    }
    if (updates.hora_inicio || updates.hora_fin) {
      const hIniEf = updates.hora_inicio || (cita.hora_inicio != null ? normHora(cita.hora_inicio)?.slice(0, 5) : null);
      const hFinEf = updates.hora_fin || (cita.hora_fin != null ? normHora(cita.hora_fin)?.slice(0, 5) : null);
      if (!hIniEf || !hFinEf || hFinEf <= hIniEf) return res.status(400).json({ error: 'Horario inválido' });
    }
    if (modalidad != null) updates.modalidad = modalidad;
    if (tipo != null) updates.tipo = tipo;
    if (estado != null) updates.estado = estado;
    if (notas != null) updates.notas = t(notas, 2000);
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Sin cambios' });
    const sets = Object.keys(updates).map(k => `${k}=?`).join(', ');
    // Generar Meet link si cambia a videollamada y no tiene uno
    const nuevaModalidad = updates.modalidad || cita.modalidad;
    if (nuevaModalidad === 'videollamada' && !cita.meet_link) {
      const fechaFinal      = updates.fecha       || cita.fecha_ymd;
      const horaInicioFinal = updates.hora_inicio  || normHora(cita.hora_inicio)?.slice(0,5);
      const horaFinFinal    = updates.hora_fin     || normHora(cita.hora_fin)?.slice(0,5);
      const [[pac]] = await pool.execute('SELECT nombre, apellido FROM pacientes WHERE id=?', [cita.paciente_id]);
      const terConGcal = await googleCal.isConnected(cita.terapeuta_id).catch(() => false);
      if (terConGcal && cita.gcal_event_id) {
        // Actualizar el evento existente en GCal con conferenceData para obtener Meet link
        try {
          const result = await googleCal.createEvent(cita.terapeuta_id, {
            titulo: gcalTitulo(pac, updates.tipo || cita.tipo),
            fecha: fechaFinal, horaInicio: horaInicioFinal, horaFin: horaFinFinal,
            descripcion: `Modalidad: videollamada`,
            withMeet: true,
          });
          if (result.meetLink) updates.meet_link = result.meetLink;
          // Borrar el evento temporal creado para Meet (el original ya existe)
          if (result.gcalEventId && result.gcalEventId !== cita.gcal_event_id) {
            googleCal.deleteEvent(cita.terapeuta_id, result.gcalEventId).catch(() => {});
          }
        } catch (e) { console.error('[meet gcal]', googleCal.detalleErrorGoogle(e)); }
      } else if (!terConGcal && await isConnected().catch(() => false)) {
        // Fallback: cuenta global
        updates.meet_link = await createMeetLink({
          titulo: `Sesión VHM${pac ? ' — ' + pac.nombre + ' ' + pac.apellido : ''}`,
          fecha: fechaFinal, horaInicio: horaInicioFinal, horaFin: horaFinFinal,
        }).catch(e => { console.error('[meet]', googleCal.detalleErrorGoogle(e)); return null; });
      }
    }
    const setsAll = Object.keys(updates).map(k => `${k}=?`).join(', ');
    await pool.execute(`UPDATE citas SET ${setsAll} WHERE id=?`, [...Object.values(updates), cid]);
    // Sincronizar con Google Calendar si hay cambios de fecha/hora
    const gcalId = cita.gcal_event_id;
    if (gcalId && (updates.fecha || updates.hora_inicio || updates.hora_fin || updates.tipo || updates.notas || updates.modalidad)) {
      try {
        const [[pac]] = await pool.execute('SELECT nombre, apellido FROM pacientes WHERE id=?', [cita.paciente_id]);
        await googleCal.updateEvent(cita.terapeuta_id, gcalId, {
          titulo: gcalTitulo(pac, updates.tipo || cita.tipo),
          fecha: updates.fecha || cita.fecha_ymd,
          horaInicio: updates.hora_inicio || String(cita.hora_inicio).slice(0,5),
          horaFin: updates.hora_fin || String(cita.hora_fin).slice(0,5),
          descripcion: `Modalidad: ${updates.modalidad || cita.modalidad}${(updates.notas || cita.notas) ? '\n' + (updates.notas || cita.notas) : ''}`,
        });
      } catch (e) { console.error('[gcal update]', googleCal.detalleErrorGoogle(e)); }
    }
    res.json({ ok: true, meet_link: updates.meet_link || cita.meet_link || null });
  } catch (err) {
    console.error('[citas/editar] cita_id=%s:', cid, err);
    res.status(500).json({ error: 'No se pudo actualizar la cita. Inténtalo nuevamente.' });
  }
});

router.patch('/:cid/estado', requireMenuPermisoApi('agenda', 'calendario'), async (req, res) => {
  const cid = pid(req.params.cid);
  if (!cid) return res.status(400).json({ error: 'ID inválido' });
  const { estado, notas, fecha } = req.body || {};
  try {
    const [[cita]] = await pool.execute('SELECT terapeuta_id FROM citas WHERE id=?', [cid]);
    if (!cita) return res.status(404).json({ error: 'No encontrada' });
    if (!isStaffAdmin(req.user.rol) && cita.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    const sets = ['estado=?'];
    const vals = [estado];
    if (notas) { sets.push('notas=?'); vals.push(t(notas, 2000)); }
    if (fecha != null && fecha !== '') {
      if (!isStaffAdmin(req.user.rol)) {
        return res.status(403).json({ error: 'Sin permiso para cambiar la fecha' });
      }
      const fechaVal = t(fecha, 10);
      if (!fechaValida(fechaVal)) {
        return res.status(400).json({ error: 'Fecha inválida' });
      }
      sets.push('fecha=?');
      vals.push(fechaVal);
    }
    vals.push(cid);
    await pool.execute(`UPDATE citas SET ${sets.join(',')} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch (err) {
    console.error('[citas/estado] cita_id=%s estado=%s:', cid, estado, err);
    res.status(500).json({ error: 'No se pudo actualizar el estado de la cita. Inténtalo nuevamente.' });
  }
});

// Enviar recordatorio manual
router.post('/:cid/recordatorio', requireMenuPermisoApi('agenda', 'calendario'), async (req, res) => {
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
    if (!isStaffAdmin(req.user.rol) && cita.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    const result = await sendRecordatorioCita(
      { nombre: cita.nombre, email: cita.email, telefono: cita.telefono },
      cita,
      { nombre: cita.t_nombre, apellido: cita.t_apellido },
      canal
    );
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[citas/recordatorio] cita_id=%s:', req.params.cid, err);
    res.status(500).json({ error: 'No se pudo enviar el recordatorio. Inténtalo nuevamente.' });
  }
});

module.exports = router;
