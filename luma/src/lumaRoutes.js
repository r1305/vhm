const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureLumaSchema } = require('./lumaSchema');

const router = Router();

router.use(async (req, res, next) => {
  try { await ensureLumaSchema(); next(); }
  catch { res.status(503).json({ error: 'Servicio inicializándose' }); }
});

// ── Guards ────────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (req.user) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.rol === 'SUPERADMIN') return next();
  return res.status(403).json({ error: 'Solo el SUPERADMIN puede realizar esta acción' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function etiquetaItem(item) {
  const disp = Number(item.disponible ?? item.cantidad);
  if (Number(item.cantidad) > 1) return `${item.nombre} x${disp}`;
  return item.nombre;
}

async function getEventoItems(eventoId) {
  const [rows] = await pool.execute(
    `SELECT i.id, i.nombre, i.cantidad, i.orden,
            i.cantidad - COALESCE((
              SELECT COUNT(*) FROM luma_registro_items ri
              INNER JOIN luma_registros r ON r.id = ri.registro_id
              WHERE ri.item_id = i.id AND r.estado != 'cancelado'
            ), 0) AS disponible,
            COALESCE((
              SELECT COUNT(*) FROM luma_registro_items ri
              INNER JOIN luma_registros r ON r.id = ri.registro_id
              WHERE ri.item_id = i.id AND r.estado != 'cancelado'
            ), 0) AS ocupados
     FROM luma_evento_items i
     WHERE i.evento_id = ?
     ORDER BY i.orden ASC, i.id ASC`,
    [eventoId]
  );
  return rows.map((r) => ({ ...r, etiqueta: etiquetaItem(r) }));
}

async function attachItemsToEventos(eventos) {
  if (!eventos.length) return eventos;
  const ids = eventos.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT i.id, i.evento_id, i.nombre, i.cantidad, i.orden,
            i.cantidad - COALESCE((
              SELECT COUNT(*) FROM luma_registro_items ri
              INNER JOIN luma_registros r ON r.id = ri.registro_id
              WHERE ri.item_id = i.id AND r.estado != 'cancelado'
            ), 0) AS disponible
     FROM luma_evento_items i
     WHERE i.evento_id IN (${placeholders})
     ORDER BY i.orden ASC, i.id ASC`,
    ids
  );
  const byEvento = {};
  for (const row of rows) {
    if (!byEvento[row.evento_id]) byEvento[row.evento_id] = [];
    byEvento[row.evento_id].push({ ...row, etiqueta: etiquetaItem(row) });
  }
  return eventos.map((e) => ({
    ...e,
    items: byEvento[e.id] || [],
    compromiso_efectivo: resolveCompromisoEfectivo(e, byEvento[e.id] || []),
  }));
}

function resolveCompromisoEfectivo(evento, items) {
  const obligatorio = evento.compromiso_obligatorio === 1 || evento.compromiso_obligatorio === true;
  if (!obligatorio) return false;
  const disponibles = (items || []).filter((i) => Number(i.disponible) > 0);
  return disponibles.length > 0;
}

async function maybeDisableCompromisoObligatorio(eventoId) {
  const items = await getEventoItems(eventoId);
  const hayDisponibles = items.some((i) => Number(i.disponible) > 0);
  if (!hayDisponibles) {
    await pool.execute(
      'UPDATE luma_eventos SET compromiso_obligatorio = 0 WHERE id = ? AND compromiso_obligatorio = 1',
      [eventoId]
    );
  }
}

async function saveEventoItems(eventoId, rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const existentes = await getEventoItems(eventoId);
  const keepIds = new Set();

  for (let i = 0; i < items.length; i++) {
    const nombre = String(items[i]?.nombre || '').trim();
    const cantidad = Math.max(1, parseInt(items[i]?.cantidad, 10) || 1);
    const id = items[i]?.id ? parseInt(items[i].id, 10) : null;
    if (!nombre) continue;

    if (id) {
      const prev = existentes.find((x) => x.id === id);
      if (!prev) continue;
      const ocupados = Number(prev.ocupados || 0);
      if (cantidad < ocupados) {
        throw new Error(`"${nombre}" ya tiene ${ocupados} persona(s) inscrita(s); no puedes bajar la cantidad.`);
      }
      await pool.execute(
        'UPDATE luma_evento_items SET nombre = ?, cantidad = ?, orden = ? WHERE id = ? AND evento_id = ?',
        [nombre, cantidad, i, id, eventoId]
      );
      keepIds.add(id);
    } else {
      const [result] = await pool.execute(
        'INSERT INTO luma_evento_items (evento_id, nombre, cantidad, orden) VALUES (?, ?, ?, ?)',
        [eventoId, nombre, cantidad, i]
      );
      keepIds.add(result.insertId);
    }
  }

  for (const prev of existentes) {
    if (keepIds.has(prev.id)) continue;
    if (Number(prev.ocupados) > 0) {
      throw new Error(`No puedes eliminar "${prev.nombre}" porque ya tiene inscritos.`);
    }
    await pool.execute('DELETE FROM luma_evento_items WHERE id = ? AND evento_id = ?', [prev.id, eventoId]);
  }
}

function parseCompromisoObligatorio(value) {
  return (value === true || value === 1 || value === '1') ? 1 : 0;
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./auth');

    const [rows] = await pool.execute(
      `SELECT a.id, a.nombre, a.usuario, a.password_hash, a.protegido, r.nombre AS rol
       FROM luma_admins a
       JOIN luma_roles r ON a.rol_id = r.id
       WHERE a.usuario = ? AND a.activo = 1`,
      [String(usuario).trim()]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: rows[0].id, nombre: rows[0].nombre, usuario: rows[0].usuario, rol: rows[0].rol, protegido: rows[0].protegido },
      JWT_SECRET, { expiresIn: '12h' }
    );
    res.json({ token, user: { id: rows[0].id, nombre: rows[0].nombre, usuario: rows[0].usuario, rol: rows[0].rol, protegido: rows[0].protegido } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al iniciar sesión' }); }
});

// ── EVENTOS PÚBLICOS ──────────────────────────────────────────────────────────

router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
              e.lugar, e.link, e.capacidad, e.imagen_url, e.compromiso_obligatorio,
              COUNT(r.id) AS registrados
       FROM luma_eventos e
       LEFT JOIN luma_registros r ON r.evento_id = e.id AND r.estado != 'cancelado'
       WHERE e.activo = 1
       GROUP BY e.id ORDER BY e.fecha ASC, e.hora_inicio ASC`
    );
    const eventos = await attachItemsToEventos(rows);
    res.json(eventos);
  } catch { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

router.get('/eventos/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.*, COUNT(r.id) AS registrados
       FROM luma_eventos e
       LEFT JOIN luma_registros r ON r.evento_id = e.id AND r.estado != 'cancelado'
       WHERE e.id = ? AND e.activo = 1 GROUP BY e.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });
    const [evento] = await attachItemsToEventos([rows[0]]);
    res.json(evento);
  } catch { res.status(500).json({ error: 'Error al obtener evento' }); }
});

router.post('/eventos/:id/registrar', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { nombre, email, telefono, notas, item_id } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: 'Email inválido' });

    const [ev] = await conn.execute(
      'SELECT id, capacidad, compromiso_obligatorio FROM luma_eventos WHERE id = ? AND activo = 1',
      [req.params.id]
    );
    if (!ev[0]) return res.status(404).json({ error: 'Evento no encontrado' });

    const [dup] = await conn.execute(
      "SELECT id FROM luma_registros WHERE evento_id = ? AND email = ? AND estado != 'cancelado'",
      [req.params.id, email.trim().toLowerCase()]
    );
    if (dup[0]) return res.status(409).json({ error: 'Ya estás registrado en este evento' });

    if (ev[0].capacidad) {
      const [[{ n }]] = await conn.execute(
        "SELECT COUNT(*) AS n FROM luma_registros WHERE evento_id = ? AND estado != 'cancelado'", [req.params.id]
      );
      if (n >= ev[0].capacidad) return res.status(409).json({ error: 'Sin cupos disponibles' });
    }

    const items = await getEventoItems(req.params.id);
    const disponibles = items.filter((i) => Number(i.disponible) > 0);
    let obligatorio = ev[0].compromiso_obligatorio === 1;
    if (obligatorio && !disponibles.length) {
      obligatorio = false;
      await conn.execute('UPDATE luma_eventos SET compromiso_obligatorio = 0 WHERE id = ?', [req.params.id]);
    }

    const itemId = item_id ? parseInt(item_id, 10) : null;
    if (obligatorio && !itemId) {
      return res.status(400).json({ error: 'Debes seleccionar en qué puedes ayudar' });
    }
    if (itemId) {
      const item = disponibles.find((i) => i.id === itemId);
      if (!item) return res.status(409).json({ error: 'Ese ítem ya no está disponible' });
    }

    await conn.beginTransaction();
    const [result] = await conn.execute(
      'INSERT INTO luma_registros (evento_id, nombre, email, telefono, notas, estado) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, nombre.trim(), email.trim().toLowerCase(),
       telefono?.trim() || null, notas?.trim() || null, 'pendiente']
    );
    if (itemId) {
      await conn.execute(
        'INSERT INTO luma_registro_items (registro_id, item_id) VALUES (?, ?)',
        [result.insertId, itemId]
      );
    }
    await conn.commit();

    await maybeDisableCompromisoObligatorio(req.params.id);
    res.status(201).json({ id: result.insertId, message: '¡Registro exitoso!' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ error: 'Error al registrar' });
  } finally {
    conn.release();
  }
});

// ── ADMIN — EVENTOS ───────────────────────────────────────────────────────────

router.get('/admin/eventos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
              e.lugar, e.link, e.capacidad, e.imagen_url, e.activo, e.compromiso_obligatorio,
              e.fecha_creacion, a.nombre AS creado_por_nombre,
              SUM(r.estado != 'cancelado') AS registrados,
              SUM(r.estado = 'confirmado') AS confirmados,
              SUM(r.estado = 'pendiente') AS pendientes,
              SUM(r.estado = 'cancelado') AS cancelados,
              SUM(r.estado != 'cancelado' AND r.asistio = 1) AS asistieron
       FROM luma_eventos e
       LEFT JOIN luma_admins a ON e.creado_por = a.id
       LEFT JOIN luma_registros r ON r.evento_id = e.id
       GROUP BY e.id ORDER BY e.fecha DESC, e.hora_inicio ASC`
    );
    const eventos = await attachItemsToEventos(rows);
    res.json(eventos);
  } catch { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

router.get('/admin/eventos/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.*, a.nombre AS creado_por_nombre
       FROM luma_eventos e
       LEFT JOIN luma_admins a ON e.creado_por = a.id
       WHERE e.id = ?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });
    const items = await getEventoItems(req.params.id);
    res.json({ ...rows[0], items });
  } catch { res.status(500).json({ error: 'Error al obtener evento' }); }
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
    const activo = (b.activo === false || b.activo === '0' || b.activo === 0) ? 0 : 1;
    const compromiso_obligatorio = parseCompromisoObligatorio(b.compromiso_obligatorio);

    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha)  return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' });
    if (!hora_inicio) return res.status(400).json({ error: 'Hora de inicio inválida' });
    if (!lugar)  return res.status(400).json({ error: 'El lugar es obligatorio' });
    if (link && !validarUrl(link)) return res.status(400).json({ error: 'Link inválido' });
    if (imagen_url && !validarUrl(imagen_url)) return res.status(400).json({ error: 'URL de imagen inválida' });

    const [result] = await pool.execute(
      `INSERT INTO luma_eventos (nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, link, capacidad, imagen_url, activo, compromiso_obligatorio, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, link, capacidad, imagen_url, activo, compromiso_obligatorio, req.user.id]
    );
    await saveEventoItems(result.insertId, b.items);
    res.status(201).json({ id: result.insertId, message: 'Evento creado' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error al crear evento' });
  }
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
    const activo = (b.activo === false || b.activo === '0' || b.activo === 0) ? 0 : 1;
    const compromiso_obligatorio = parseCompromisoObligatorio(b.compromiso_obligatorio);

    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!fecha)  return res.status(400).json({ error: 'Fecha inválida' });
    if (!hora_inicio) return res.status(400).json({ error: 'Hora de inicio inválida' });
    if (!lugar)  return res.status(400).json({ error: 'El lugar es obligatorio' });
    if (link && !validarUrl(link)) return res.status(400).json({ error: 'Link inválido' });
    if (imagen_url && !validarUrl(imagen_url)) return res.status(400).json({ error: 'URL de imagen inválida' });

    const [result] = await pool.execute(
      `UPDATE luma_eventos SET nombre=?, descripcion=?, fecha=?, hora_inicio=?, hora_fin=?,
       lugar=?, link=?, capacidad=?, imagen_url=?, activo=?, compromiso_obligatorio=? WHERE id=?`,
      [nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, link, capacidad, imagen_url, activo, compromiso_obligatorio, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    await saveEventoItems(req.params.id, b.items);
    await maybeDisableCompromisoObligatorio(req.params.id);
    res.json({ message: 'Evento actualizado' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error al actualizar evento' });
  }
});

router.delete('/admin/eventos/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM luma_eventos WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar evento' }); }
});

// ── ADMIN — REGISTROS ─────────────────────────────────────────────────────────

router.get('/admin/eventos/:id/registros', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.nombre, r.email, r.telefono, r.notas, r.estado, r.asistio,
              r.fecha_asistencia, r.fecha_registro, i.nombre AS item_nombre, i.cantidad AS item_cantidad
       FROM luma_registros r
       LEFT JOIN luma_registro_items ri ON ri.registro_id = r.id
       LEFT JOIN luma_evento_items i ON i.id = ri.item_id
       WHERE r.evento_id = ?
       ORDER BY r.asistio DESC, r.nombre ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener registros' }); }
});

router.patch('/admin/registros/:id/asistencia', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const asistio = req.body?.asistio === true || req.body?.asistio === 1 || req.body?.asistio === '1';
    const [r] = await pool.execute(
      'UPDATE luma_registros SET asistio = ?, fecha_asistencia = ? WHERE id = ? AND estado != ?',
      [asistio ? 1 : 0, asistio ? new Date() : null, req.params.id, 'cancelado']
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado o cancelado' });
    res.json({ message: asistio ? 'Asistencia registrada' : 'Asistencia removida', asistio: asistio ? 1 : 0 });
  } catch { res.status(500).json({ error: 'Error al actualizar asistencia' }); }
});

router.patch('/admin/registros/:id/estado', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const estado = req.body?.estado;
    if (!['pendiente', 'confirmado', 'cancelado'].includes(estado))
      return res.status(400).json({ error: 'Estado inválido' });
    const [r] = await pool.execute('UPDATE luma_registros SET estado = ? WHERE id = ?', [estado, req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Estado actualizado' });
  } catch { res.status(500).json({ error: 'Error al actualizar estado' }); }
});

router.delete('/admin/registros/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM luma_registros WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Registro eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar registro' }); }
});

// ── ADMIN — STATS ─────────────────────────────────────────────────────────────

router.get('/admin/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [[{ total_eventos }]] = await pool.execute('SELECT COUNT(*) AS total_eventos FROM luma_eventos WHERE activo = 1');
    const [[{ total_registros }]] = await pool.execute("SELECT COUNT(*) AS total_registros FROM luma_registros WHERE estado != 'cancelado'");
    const [[{ confirmados }]] = await pool.execute("SELECT COUNT(*) AS confirmados FROM luma_registros WHERE estado = 'confirmado'");
    const [[{ asistieron }]] = await pool.execute("SELECT COUNT(*) AS asistieron FROM luma_registros WHERE estado != 'cancelado' AND asistio = 1");
    const [[{ proximos }]] = await pool.execute('SELECT COUNT(*) AS proximos FROM luma_eventos WHERE activo = 1 AND fecha >= CURDATE()');
    res.json({ total_eventos, total_registros, confirmados, asistieron, proximos });
  } catch { res.status(500).json({ error: 'Error al obtener stats' }); }
});

// ── ADMIN — ADMINISTRADORES ───────────────────────────────────────────────────

router.get('/admin/admins', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.nombre, a.usuario, a.protegido, a.activo, a.fecha_creacion,
              r.id AS rol_id, r.nombre AS rol
       FROM luma_admins a
       JOIN luma_roles r ON a.rol_id = r.id
       ORDER BY a.protegido DESC, a.fecha_creacion ASC`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener administradores' }); }
});

router.post('/admin/admins', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { nombre, usuario, password, rol_id, activo } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!usuario?.trim()) return res.status(400).json({ error: 'El usuario es obligatorio' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    if (!rol_id) return res.status(400).json({ error: 'El rol es obligatorio' });

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO luma_admins (nombre, usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, ?)',
      [nombre.trim(), usuario.trim(), hash, rol_id, activo === false || activo === '0' ? 0 : 1]
    );
    res.status(201).json({ id: result.insertId, message: 'Administrador creado' });
  } catch (e) {
    console.error('[POST /admin/admins]', e.code, e.message);
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El usuario ya está registrado' });
    res.status(500).json({ error: e.message || 'Error al crear administrador' });
  }
});

router.put('/admin/admins/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [target] = await pool.execute('SELECT protegido FROM luma_admins WHERE id = ?', [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: 'Administrador no encontrado' });
    if (target[0].protegido && req.user.protegido !== 1)
      return res.status(403).json({ error: 'No puedes modificar al administrador protegido' });

    const { nombre, usuario, password, rol_id, activo } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!usuario?.trim()) return res.status(400).json({ error: 'El usuario es obligatorio' });
    if (!rol_id) return res.status(400).json({ error: 'El rol es obligatorio' });

    const bcrypt = require('bcryptjs');
    if (password && password.length > 0) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      const hash = await bcrypt.hash(password, 12);
      await pool.execute(
        'UPDATE luma_admins SET nombre=?, usuario=?, password_hash=?, rol_id=?, activo=? WHERE id=?',
        [nombre.trim(), usuario.trim(), hash, rol_id, activo === false || activo === '0' ? 0 : 1, req.params.id]
      );
    } else {
      await pool.execute(
        'UPDATE luma_admins SET nombre=?, usuario=?, rol_id=?, activo=? WHERE id=?',
        [nombre.trim(), usuario.trim(), rol_id, activo === false || activo === '0' ? 0 : 1, req.params.id]
      );
    }
    res.json({ message: 'Administrador actualizado' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El usuario ya está registrado' });
    res.status(500).json({ error: 'Error al actualizar administrador' });
  }
});

router.delete('/admin/admins/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [target] = await pool.execute('SELECT protegido FROM luma_admins WHERE id = ?', [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: 'Administrador no encontrado' });
    if (target[0].protegido) return res.status(403).json({ error: 'No se puede eliminar al administrador protegido' });
    if (parseInt(req.params.id) === req.user.id) return res.status(403).json({ error: 'No puedes eliminarte a ti mismo' });
    await pool.execute('DELETE FROM luma_admins WHERE id = ?', [req.params.id]);
    res.json({ message: 'Administrador eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar administrador' }); }
});

// ── ADMIN — ROLES ─────────────────────────────────────────────────────────────

router.get('/admin/roles', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.nombre, r.descripcion, r.protegido, r.fecha_creacion,
              COUNT(a.id) AS total_admins
       FROM luma_roles r
       LEFT JOIN luma_admins a ON a.rol_id = r.id
       GROUP BY r.id ORDER BY r.protegido DESC, r.fecha_creacion ASC`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener roles' }); }
});

router.post('/admin/roles', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { nombre, descripcion } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const [result] = await pool.execute(
      'INSERT INTO luma_roles (nombre, descripcion) VALUES (?, ?)',
      [nombre.trim().toUpperCase(), descripcion?.trim() || null]
    );
    res.status(201).json({ id: result.insertId, message: 'Rol creado' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ error: 'Error al crear rol' });
  }
});

router.put('/admin/roles/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [target] = await pool.execute('SELECT protegido FROM luma_roles WHERE id = ?', [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: 'Rol no encontrado' });
    if (target[0].protegido) return res.status(403).json({ error: 'El rol SUPERADMIN no puede ser modificado' });

    const { nombre, descripcion } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    await pool.execute(
      'UPDATE luma_roles SET nombre=?, descripcion=? WHERE id=?',
      [nombre.trim().toUpperCase(), descripcion?.trim() || null, req.params.id]
    );
    res.json({ message: 'Rol actualizado' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

router.delete('/admin/roles/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [target] = await pool.execute('SELECT protegido FROM luma_roles WHERE id = ?', [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: 'Rol no encontrado' });
    if (target[0].protegido) return res.status(403).json({ error: 'El rol SUPERADMIN no puede ser eliminado' });
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM luma_admins WHERE rol_id = ?', [req.params.id]);
    if (n > 0) return res.status(409).json({ error: `No se puede eliminar: ${n} administrador(es) tienen este rol` });
    await pool.execute('DELETE FROM luma_roles WHERE id = ?', [req.params.id]);
    res.json({ message: 'Rol eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar rol' }); }
});

// ── ADMIN — ACCESOS ───────────────────────────────────────────────────────────

router.get('/admin/accesos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [accesos] = await pool.execute('SELECT id, clave, nombre, descripcion FROM luma_accesos ORDER BY id ASC');
    res.json(accesos);
  } catch { res.status(500).json({ error: 'Error al obtener accesos' }); }
});

// Accesos asignados a un rol
router.get('/admin/roles/:id/accesos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.clave, a.nombre, a.descripcion,
              IF(ra.acceso_id IS NOT NULL, 1, 0) AS asignado
       FROM luma_accesos a
       LEFT JOIN luma_rol_accesos ra ON ra.acceso_id = a.id AND ra.rol_id = ?
       ORDER BY a.id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al obtener accesos del rol' }); }
});

// Guardar accesos de un rol (reemplaza todos)
router.put('/admin/roles/:id/accesos', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [target] = await pool.execute('SELECT protegido FROM luma_roles WHERE id = ?', [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: 'Rol no encontrado' });
    if (target[0].protegido) return res.status(403).json({ error: 'Los accesos del SUPERADMIN no pueden modificarse' });

    const acceso_ids = Array.isArray(req.body?.acceso_ids) ? req.body.acceso_ids : [];
    await pool.execute('DELETE FROM luma_rol_accesos WHERE rol_id = ?', [req.params.id]);
    for (const aid of acceso_ids) {
      await pool.execute('INSERT IGNORE INTO luma_rol_accesos (rol_id, acceso_id) VALUES (?, ?)', [req.params.id, aid]);
    }
    res.json({ message: 'Accesos actualizados' });
  } catch { res.status(500).json({ error: 'Error al actualizar accesos' }); }
});

module.exports = router;
