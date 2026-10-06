const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureSchema: ensureVideoSchema } = require('./schema');
const { tribuAuthMiddleware } = require('./tribuAuthRoutes');
const { buildEventIcs } = require('../lib/tribuEventoIcs');

const router = Router();

const EVENTO_TIPOS = new Set(['sesiones', 'social', 'bienestar', 'actividad', 'aprendizaje', 'otro']);

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
  const descripcionRaw = String((body && body.descripcion) || '').trim();
  const descripcion = descripcionRaw || null;
  const facilitadorRaw = String((body && body.facilitador) || '').trim();
  const facilitador = facilitadorRaw ? facilitadorRaw.slice(0, 120) : null;
  let tipo = String((body && body.tipo) || 'sesiones').trim().toLowerCase();
  if (!EVENTO_TIPOS.has(tipo)) tipo = 'sesiones';

  if (!nombre)      return { error: 'El nombre es obligatorio' };
  if (!fecha)       return { error: 'La fecha es obligatoria (formato AAAA-MM-DD)' };
  if (!hora_inicio) return { error: 'La hora de inicio es obligatoria (formato HH:MM)' };
  if (hora_fin_raw && !hora_fin) return { error: 'La hora de fin no es válida (formato HH:MM)' };
  if (!lugar)       return { error: 'El lugar es obligatorio' };
  if (ubicacion && !validarUrl(ubicacion)) return { error: 'El link debe ser un enlace válido (http o https)' };

  return { nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, activo, descripcion, facilitador, tipo };
}

async function tribuTieneSuscripcion(userId) {
  await pool.execute(
    `UPDATE tribu_suscripciones SET activo = 0, auto_renovacion = 0
      WHERE tribu_user_id = ? AND activo = 1 AND fecha_fin < CURDATE()`,
    [userId]
  );
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM tribu_suscripciones
      WHERE tribu_user_id = ? AND activo = 1 AND fecha_fin >= CURDATE()`,
    [userId]
  );
  return (row?.total || 0) > 0;
}

async function fetchEventoActivo(id) {
  const [rows] = await pool.execute(
    `SELECT id, nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, descripcion, facilitador, tipo
     FROM tribu_eventos WHERE id = ? AND activo = 1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function hoyLimaYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function ahoraLimaHm() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function eventoEsPasado(ev) {
  const f = String(ev.fecha).slice(0, 10);
  const hoy = hoyLimaYmd();
  if (f < hoy) return true;
  if (f > hoy) return false;
  let endHm = ev.hora_fin ? String(ev.hora_fin).slice(0, 5) : null;
  if (!endHm && ev.hora_inicio) {
    const [hh, mm] = String(ev.hora_inicio).slice(0, 5).split(':').map(Number);
    const total = hh * 60 + mm + 60;
    endHm = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  if (!endHm) return false;
  return endHm <= ahoraLimaHm();
}

function icsFilename(ev) {
  const slug = String(ev.nombre || 'evento').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `la-tribu-${slug || 'evento'}.ics`;
}

// Público
router.get('/', async (req, res) => {
  try {
    const mes = String(req.query.mes || '').trim();
    let sql = `SELECT id, nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion,
                      descripcion, facilitador, tipo
               FROM tribu_eventos WHERE activo = 1`;
    const params = [];
    if (/^\d{4}-\d{2}$/.test(mes)) { sql += ' AND DATE_FORMAT(fecha, "%Y-%m") = ?'; params.push(mes); }
    sql += ' ORDER BY fecha ASC, hora_inicio ASC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

// Miembro — ids de eventos reservados
router.get('/mis-reservas', tribuAuthMiddleware, async (req, res) => {
  try {
    const ok = await tribuTieneSuscripcion(req.tribuUser.id);
    if (!ok) return res.status(403).json({ error: 'Necesitas una suscripción activa' });
    const [rows] = await pool.execute(
      'SELECT evento_id FROM tribu_evento_reservas WHERE tribu_user_id = ?',
      [req.tribuUser.id]
    );
    res.json({ evento_ids: rows.map(r => r.evento_id) });
  } catch {
    res.status(500).json({ error: 'Error al obtener reservas' });
  }
});

// Miembro — reservar lugar
router.post('/:id/reservar', tribuAuthMiddleware, async (req, res) => {
  try {
    const userId = req.tribuUser.id;
    const ok = await tribuTieneSuscripcion(userId);
    if (!ok) return res.status(403).json({ error: 'Necesitas una suscripción activa' });
    const ev = await fetchEventoActivo(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
    if (eventoEsPasado(ev)) return res.status(400).json({ error: 'Este encuentro ya pasó' });
    await pool.execute(
      `INSERT INTO tribu_evento_reservas (evento_id, tribu_user_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE evento_id = evento_id`,
      [ev.id, userId]
    );
    res.status(201).json({ reservado: true, evento_id: ev.id });
  } catch {
    res.status(500).json({ error: 'No se pudo completar la reserva' });
  }
});

// Miembro — cancelar reserva
router.delete('/:id/reservar', tribuAuthMiddleware, async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM tribu_evento_reservas WHERE evento_id = ? AND tribu_user_id = ?',
      [req.params.id, req.tribuUser.id]
    );
    res.json({ reservado: false, evento_id: Number(req.params.id) });
  } catch {
    res.status(500).json({ error: 'No se pudo cancelar la reserva' });
  }
});

// Miembro — descargar .ics (suscripción activa)
router.get('/:id/ics', tribuAuthMiddleware, async (req, res) => {
  try {
    const ok = await tribuTieneSuscripcion(req.tribuUser.id);
    if (!ok) return res.status(403).json({ error: 'Necesitas una suscripción activa' });
    const ev = await fetchEventoActivo(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
    const base = (process.env.SITE_URL || process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
    const calUrl = base ? `${base}/calendario` : '';
    const body = buildEventIcs(ev, {
      uidHost: process.env.SITE_URL || 'latribu.vhm.pe',
      calUrl,
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${icsFilename(ev)}"`);
    res.send(body);
  } catch {
    res.status(500).json({ error: 'No se pudo generar el calendario' });
  }
});

// Admin — listar
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.fecha, e.hora_inicio, e.hora_fin, e.lugar, e.ubicacion,
              e.descripcion, e.facilitador, e.tipo, e.activo, e.fecha_creacion, u.nombre AS creado_por_nombre
       FROM tribu_eventos e
       LEFT JOIN tribu_admins u ON e.creado_por = u.id
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
      `INSERT INTO tribu_eventos (nombre, fecha, hora_inicio, hora_fin, lugar, ubicacion, descripcion, facilitador, tipo, activo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, datos.lugar, datos.ubicacion,
        datos.descripcion, datos.facilitador, datos.tipo, datos.activo, req.user.id]
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
       lugar=?, ubicacion=?, descripcion=?, facilitador=?, tipo=?, activo=? WHERE id=?`,
      [datos.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, datos.lugar, datos.ubicacion,
        datos.descripcion, datos.facilitador, datos.tipo, datos.activo, req.params.id]
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
