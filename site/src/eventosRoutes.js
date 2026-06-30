const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureVideoSchema } = require('./ensureSchema');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

router.use(async (req, res, next) => {
  try { await ensureVideoSchema(); next(); }
  catch (err) { res.status(503).json({ error: 'El servicio se está inicializando.' }); }
});

function validarUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function parseFecha(str) {
  // Validar solo formato AAAA-MM-DD sin convertir a Date (evita desfase de timezone)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return str; // devolver el string tal cual, sin pasar por Date
}

function parseHora(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;
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

  if (!nombre)      return { error: 'El nombre es obligatorio' };
  if (!fecha)       return { error: 'La fecha es obligatoria (formato AAAA-MM-DD)' };
  if (!hora_inicio) return { error: 'La hora de inicio es obligatoria (formato HH:MM)' };
  if (hora_fin_raw && !hora_fin) return { error: 'La hora de fin no es válida (formato HH:MM)' };
  if (!lugar)       return { error: 'El lugar es obligatorio' };
  if (ubicacion && !validarUrl(ubicacion)) return { error: 'El link debe ser un enlace válido (http o https)' };

  return { nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, activo };
}

// Público
router.get('/', async (req, res) => {
  try {
    const mes = String(req.query.mes || '').trim();
    let sql = `SELECT id, nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion
               FROM tribu_eventos WHERE activo = 1`;
    const params = [];
    if (/^\d{4}-\d{2}$/.test(mes)) { sql += ' AND DATE_FORMAT(fecha, "%Y-%m") = ?'; params.push(mes); }
    sql += ' ORDER BY fecha ASC, hora_inicio ASC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

// Admin — listar
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.fecha, e.hora_inicio, e.hora_fin, e.lugar, e.ubicacion,
              e.activo, e.fecha_creacion, u.nombre AS creado_por_nombre
       FROM tribu_eventos e
       LEFT JOIN usuarios u ON e.creado_por = u.id
       ORDER BY e.fecha DESC, e.hora_inicio ASC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

// Admin — crear
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const datos = normalizarBody(req.body);
    if (datos.error) return res.status(400).json({ error: datos.error });
    const [result] = await pool.execute(
      `INSERT INTO tribu_eventos (nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, activo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, datos.lugar, datos.ubicacion, datos.activo, req.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'Evento creado' });
  } catch (err) { res.status(500).json({ error: 'Error al crear evento' }); }
});

// Admin — actualizar
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const datos = normalizarBody(req.body);
    if (datos.error) return res.status(400).json({ error: datos.error });
    const [result] = await pool.execute(
      `UPDATE tribu_eventos SET nombre=?, fecha=?, hora_inicio=?, hora_fin=?,
       lugar=?, ubicacion=?, activo=? WHERE id=?`,
      [datos.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, datos.lugar, datos.ubicacion, datos.activo, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento actualizado' });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar evento' }); }
});

// Admin — eliminar
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM tribu_eventos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar evento' }); }
});

module.exports = router;
