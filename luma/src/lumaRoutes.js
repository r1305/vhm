const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureLumaSchema } = require('./lumaSchema');

const router = Router();

router.use(async (req, res, next) => {
  try { await ensureLumaSchema(); next(); }
  catch { res.status(503).json({ error: 'Servicio inicializándose' }); }
});

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

function parseFecha(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return str;
}

function parseHora(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

function validarUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// ─── EVENTOS PÚBLICOS ────────────────────────────────────────────────────────

router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
              e.lugar, e.link, e.capacidad, e.imagen_url,
              COUNT(r.id) AS registrados
       FROM luma_eventos e
       LEFT JOIN luma_registros r ON r.evento_id = e.id AND r.estado != 'cancelado'
       WHERE e.activo = 1
       GROUP BY e.id
       ORDER BY e.fecha ASC, e.hora_inicio ASC`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

router.get('/eventos/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.*, COUNT(r.id) AS registrados
       FROM luma_eventos e
       LEFT JOIN luma_registros r ON r.evento_id = e.id AND r.estado != 'cancelado'
       WHERE e.id = ? AND e.activo = 1
       GROUP BY e.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Error al obtener evento' }); }
});

// ─── REGISTRO PÚBLICO ────────────────────────────────────────────────────────

router.post('/eventos/:id/registrar', async (req, res) => {
  try {
    const { nombre, email, telefono, notas } = req.body || {};
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()))
      return res.status(400).json({ error: 'Email inválido' });

    const [eventos] = await pool.execute(
      'SELECT id, capacidad FROM luma_eventos WHERE id = ? AND activo = 1',
      [req.params.id]
    );
    if (!eventos[0]) return res.status(404).json({ error: 'Evento no encontrado' });

    const [dup] = await pool.execute(
      "SELECT id FROM luma_registros WHERE evento_id = ? AND email = ? AND estado != 'cancelado'",
      [req.params.id, String(email).trim().toLowerCase()]
    );
    if (dup[0]) return res.status(409).json({ error: 'Ya estás registrado en este evento' });

    if (eventos[0].capacidad) {
      const [cnt] = await pool.execute(
        "SELECT COUNT(*) AS n FROM luma_registros WHERE evento_id = ? AND estado != 'cancelado'",
        [req.params.id]
      );
      if (cnt[0].n >= eventos[0].capacidad)
        return res.status(409).json({ error: 'El evento ya no tiene cupos disponibles' });
    }

    const [result] = await pool.execute(
      'INSERT INTO luma_registros (evento_id, nombre, email, telefono, notas, estado) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, String(nombre).trim(), String(email).trim().toLowerCase(),
       telefono ? String(telefono).trim() : null, notas ? String(notas).trim() : null, 'pendiente']
    );
    res.status(201).json({ id: result.insertId, message: '¡Registro exitoso!' });
  } catch { res.status(500).json({ error: 'Error al registrar' }); }
});

// ─── AUTH ADMIN ──────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./auth');
    const [rows] = await pool.execute(
      'SELECT id, nombre, email, password_hash, rol FROM luma_admins WHERE email = ? AND activo = 1',
      [String(email).trim().toLowerCase()]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign(
      { id: rows[0].id, nombre: rows[0].nombre, email: rows[0].email, rol: rows[0].rol },
      JWT_SECRET, { expiresIn: '12h' }
    );
    res.json({ token, user: { id: rows[0].id, nombre: rows[0].nombre, email: rows[0].email, rol: rows[0].rol } });
  } catch { res.status(500).json({ error: 'Error al iniciar sesión' }); }
});

// ─── ADMIN — EVENTOS ─────────────────────────────────────────────────────────

router.get('/admin/eventos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
              e.lugar, e.link, e.capacidad, e.imagen_url, e.activo, e.fecha_creacion,
              a.nombre AS creado_por_nombre,
              COUNT(r.id) AS registrados,
              SUM(r.estado = 'confirmado') AS confirmados,
              SUM(r.estado = 'pendiente') AS pendientes,
              SUM(r.estado = 'cancelado') AS cancelados
       FROM luma_eventos e
       LEFT JOIN luma_admins a ON e.creado_por = a.id
       LEFT JOIN luma_registros r ON r.evento_id = e.id
       GROUP BY e.id
       ORDER BY e.fecha DESC, e.hora_inicio ASC`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

router.post('/admin/eventos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim();
    const fecha = parseFecha(String(b.fecha || '').trim());
    const hora_inicio = parseHora(b.hora_inicio);
    const hora_fin = b.hora_fin ? parseHora(b.hora_fin) : null;
    const lugar = String(b.lugar || '').trim();
    const link = b.link ? String(b.link).trim() : null;
    const capacidad = b.capacidad ? parseInt(b.capacidad, 10) : null;
    const descripcion = b.descripcion ? String(b.descripcion).trim() : null;
    const imagen_url = b.imagen_url ? String(b.imagen_url).trim() : null;
    const activo = b.activo === false || b.activo === '0' || b.activo === 0 ? 0 : 1;

    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha)  return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' });
    if (!hora_inicio) return res.status(400).json({ error: 'Hora de inicio inválida' });
    if (!lugar)  return res.status(400).json({ error: 'El lugar es obligatorio' });
    if (link && !validarUrl(link)) return res.status(400).json({ error: 'Link inválido' });
    if (imagen_url && !validarUrl(imagen_url)) return res.status(400).json({ error: 'URL de imagen inválida' });

    const [result] = await pool.execute(
      `INSERT INTO luma_eventos (nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, link, capacidad, imagen_url, activo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, link, capacidad, imagen_url, activo, req.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'Evento creado' });
  } catch { res.status(500).json({ error: 'Error al crear evento' }); }
});

router.put('/admin/eventos/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim();
    const fecha = parseFecha(String(b.fecha || '').trim());
    const hora_inicio = parseHora(b.hora_inicio);
    const hora_fin = b.hora_fin ? parseHora(b.hora_fin) : null;
    const lugar = String(b.lugar || '').trim();
    const link = b.link ? String(b.link).trim() : null;
    const capacidad = b.capacidad ? parseInt(b.capacidad, 10) : null;
    const descripcion = b.descripcion ? String(b.descripcion).trim() : null;
    const imagen_url = b.imagen_url ? String(b.imagen_url).trim() : null;
    const activo = b.activo === false || b.activo === '0' || b.activo === 0 ? 0 : 1;

    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha)  return res.status(400).json({ error: 'Fecha inválida' });
    if (!hora_inicio) return res.status(400).json({ error: 'Hora de inicio inválida' });
    if (!lugar)  return res.status(400).json({ error: 'El lugar es obligatorio' });
    if (link && !validarUrl(link)) return res.status(400).json({ error: 'Link inválido' });
    if (imagen_url && !validarUrl(imagen_url)) return res.status(400).json({ error: 'URL de imagen inválida' });

    const [result] = await pool.execute(
      `UPDATE luma_eventos SET nombre=?, descripcion=?, fecha=?, hora_inicio=?, hora_fin=?,
       lugar=?, link=?, capacidad=?, imagen_url=?, activo=? WHERE id=?`,
      [nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, link, capacidad, imagen_url, activo, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento actualizado' });
  } catch { res.status(500).json({ error: 'Error al actualizar evento' }); }
});

router.delete('/admin/eventos/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM luma_eventos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar evento' }); }
});

// ─── ADMIN — REGISTROS ───────────────────────────────────────────────────────

router.get('/admin/eventos/:id/registros', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, nombre, email, telefono, notas, estado, fecha_registro
       FROM luma_registros WHERE evento_id = ? ORDER BY fecha_registro ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener registros' }); }
});

router.patch('/admin/registros/:id/estado', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const estado = req.body?.estado;
    if (!['pendiente', 'confirmado', 'cancelado'].includes(estado))
      return res.status(400).json({ error: 'Estado inválido' });
    const [result] = await pool.execute(
      'UPDATE luma_registros SET estado = ? WHERE id = ?', [estado, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Estado actualizado' });
  } catch { res.status(500).json({ error: 'Error al actualizar estado' }); }
});

router.delete('/admin/registros/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM luma_registros WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Registro eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar registro' }); }
});

// ─── ADMIN — STATS ───────────────────────────────────────────────────────────

router.get('/admin/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [[{ total_eventos }]] = await pool.execute('SELECT COUNT(*) AS total_eventos FROM luma_eventos WHERE activo = 1');
    const [[{ total_registros }]] = await pool.execute("SELECT COUNT(*) AS total_registros FROM luma_registros WHERE estado != 'cancelado'");
    const [[{ confirmados }]] = await pool.execute("SELECT COUNT(*) AS confirmados FROM luma_registros WHERE estado = 'confirmado'");
    const [[{ proximos }]] = await pool.execute('SELECT COUNT(*) AS proximos FROM luma_eventos WHERE activo = 1 AND fecha >= CURDATE()');
    res.json({ total_eventos, total_registros, confirmados, proximos });
  } catch { res.status(500).json({ error: 'Error al obtener stats' }); }
});

module.exports = router;
