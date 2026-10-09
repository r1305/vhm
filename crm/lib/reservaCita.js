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

async function bloquearFranja(conn, { terapeutaId, fecha, horaInicio, horaFin }) {
  const [[ter]] = await conn.execute(
    'SELECT id FROM terapeutas WHERE id=? AND activo=1 FOR UPDATE',
    [terapeutaId]
  );
  if (!ter) throw errorPublico(404, 'Terapeuta no encontrado');
  await conn.execute(
    'SELECT id FROM disponibilidad WHERE terapeuta_id=? AND dia_semana=? AND activo=1 FOR UPDATE',
    [terapeutaId, diaSemanaLima(fecha)]
  );
  const [[choque]] = await conn.execute(
    `SELECT id FROM citas
     WHERE terapeuta_id=? AND fecha=? AND estado <> 'cancelada'
       AND hora_inicio < ? AND hora_fin > ?
     LIMIT 1 FOR UPDATE`,
    [terapeutaId, fecha, horaFin, horaInicio]
  );
  if (choque) throw errorPublico(409, 'Ese horario ya no está disponible');
}

module.exports = { normHora, sumarHora, fechaValida, diaSemanaLima, errorPublico, bloquearFranja };
