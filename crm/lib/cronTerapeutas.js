const pool = require('./db');

async function listarTerapeutasRecordatorio() {
  const [rows] = await pool.execute(
    `SELECT t.id, t.nombre, t.apellido,
            (t.telefono IS NOT NULL AND TRIM(t.telefono) != '') AS tiene_telefono,
            (x.terapeuta_id IS NULL) AS recibe,
            (SELECT COUNT(*) FROM pacientes p WHERE p.terapeuta_id = t.id AND p.estado = 'activo') AS pacientes_activos
     FROM terapeutas t
     LEFT JOIN cron_terapeutas_excluidos x ON x.terapeuta_id = t.id
     WHERE t.rol = 'terapeuta' AND t.activo = 1
     ORDER BY t.nombre, t.apellido`
  );
  return rows.map(r => ({
    id: r.id,
    nombre: r.nombre,
    apellido: r.apellido,
    tiene_telefono: !!r.tiene_telefono,
    recibe: !!r.recibe,
    pacientes_activos: Number(r.pacientes_activos) || 0,
    tiene_pacientes: Number(r.pacientes_activos) > 0,
  }));
}

async function guardarSeleccionRecordatorio(ids) {
  const [validos] = await pool.execute("SELECT id FROM terapeutas WHERE rol = 'terapeuta'");
  const validSet = new Set(validos.map(r => Number(r.id)));
  const seleccion = new Set();
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isInteger(id) || !validSet.has(id)) {
      const err = new Error('Terapeuta inválido en la selección');
      err.status = 400;
      throw err;
    }
    seleccion.add(id);
  }
  const excluidos = [...validSet].filter(id => !seleccion.has(id));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM cron_terapeutas_excluidos');
    for (const id of excluidos) {
      await conn.execute('INSERT INTO cron_terapeutas_excluidos (terapeuta_id) VALUES (?)', [id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { listarTerapeutasRecordatorio, guardarSeleccionRecordatorio };
