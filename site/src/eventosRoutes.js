const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureVideoSchema } = require('./ensureSchema');

const router = Router();

function requireSuperAdmin(req, res, next) {
  if (req.user && req.user.rol === 'SUPER_ADMIN') return next();
  return res.status(403).json({ error: 'Acceso restringido al Super Admin' });
}

router.use(async (req, res, next) => {
  try {
    await ensureVideoSchema();
    next();
  } catch (err) {
    console.error('[vhm] Esquema de eventos no disponible:', err.message);
    res.status(503).json({ error: 'El servicio se está inicializando, intenta de nuevo en unos segundos.' });
  }
});

function validarUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseFecha(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return str;
}

function parseHora(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

function normalizarBody(body) {
  const nombre = String((body && body.nombre) || '').trim();
  const fecha = parseFecha(String((body && body.fecha) || '').trim());
  const hora_inicio = parseHora((body && body.hora_inicio) || '');
  const hora_fin_raw = (body && body.hora_fin) ? String(body.hora_fin).trim() : '';
  const hora_fin = hora_fin_raw ? parseHora(hora_fin_raw) : null;
  const lugar = String((body && body.lugar) || '').trim();
  const ubicacionRaw = String((body && body.ubicacion) || '').trim();
  const ubicacion = ubicacionRaw || null;
  const activo = body && (body.activo === false || body.activo === '0' || body.activo === 0) ? 0 : 1;

  if (!nombre) return { error: 'El nombre es obligatorio' };
  if (!fecha) return { error: 'La fecha es obligatoria (formato AAAA-MM-DD)' };
  if (!hora_inicio) return { error: 'La hora de inicio es obligatoria (formato HH:MM)' };
  if (hora_fin_raw && !hora_fin) return { error: 'La hora de fin no es válida (formato HH:MM)' };
  if (!lugar) return { error: 'El lugar es obligatorio' };
  if (ubicacion && !validarUrl(ubicacion)) {
    return { error: 'El link debe ser un enlace válido (http o https)' };
  }

  return { nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, activo };
}

// Listado público de eventos activos (filtrable por mes: ?mes=2026-06)
router.get('/', async (req, res) => {
  try {
    const mes = String(req.query.mes || '').trim();
    let sql = `SELECT id, nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion
                 FROM tribu_eventos WHERE activo = 1`;
    const params = [];
    if (/^\d{4}-\d{2}$/.test(mes)) {
      sql += ' AND DATE_FORMAT(fecha, "%Y-%m") = ?';
      params.push(mes);
    }
    sql += ' ORDER BY fecha ASC, hora_inicio ASC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, activo, fecha_creacion
         FROM tribu_eventos ORDER BY fecha DESC, hora_inicio ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const datos = normalizarBody(req.body);
    if (datos.error) return res.status(400).json({ error: datos.error });

    const [result] = await pool.execute(
      `INSERT INTO tribu_eventos (nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [datos.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, datos.lugar, datos.ubicacion, datos.activo]
    );
    res.status(201).json({ id: result.insertId, message: 'Evento creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear evento' });
  }
});

router.put('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const datos = normalizarBody(req.body);
    if (datos.error) return res.status(400).json({ error: datos.error });

    const [result] = await pool.execute(
      `UPDATE tribu_eventos SET nombre = ?, fecha = ?, hora_inicio = ?, hora_fin = ?,
              lugar = ?, ubicacion = ?, activo = ? WHERE id = ?`,
      [datos.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, datos.lugar, datos.ubicacion, datos.activo, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar evento' });
  }
});

router.delete('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM tribu_eventos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
});

module.exports = router;
