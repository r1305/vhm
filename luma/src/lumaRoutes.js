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
              e.lugar, e.link, e.capacidad, e.imagen_url,
              COUNT(r.id) AS registrados
       FROM luma_eventos e
       LEFT JOIN luma_registros r ON r.evento_id = e.id AND r.estado != 'cancelado'
       WHERE e.activo = 1
       GROUP BY e.id ORDER BY e.fecha ASC, e.hora_inicio ASC`
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
       WHERE e.id = ? AND e.activo = 1 GROUP BY e.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Error al obtener evento' }); }
});

router.post('/eventos/:id/registrar', async (req, res) => {
  try {
    const { nombre, email, telefono, notas } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: 'Email inválido' });

    const [ev] = await pool.execute('SELECT id, capacidad FROM luma_eventos WHERE id = ? AND activo = 1', [req.params.id]);
    if (!ev[0]) return res.status(404).json({ error: 'Evento no encontrado' });

    const [dup] = await pool.execute(
      "SELECT id FROM luma_registros WHERE evento_id = ? AND email = ? AND estado != 'cancelado'",
      [req.params.id, email.trim().toLowerCase()]
    );
    if (dup[0]) return res.status(409).json({ error: 'Ya estás registrado en este evento' });

    if (ev[0].capacidad) {
      const [[{ n }]] = await pool.execute(
        "SELECT COUNT(*) AS n FROM luma_registros WHERE evento_id = ? AND estado != 'cancelado'", [req.params.id]
      );
      if (n >= ev[0].capacidad) return res.status(409).json({ error: 'Sin cupos disponibles' });
    }

    const [result] = await pool.execute(
      'INSERT INTO luma_registros (evento_id, nombre, email, telefono, notas, estado) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, nombre.trim(), email.trim().toLowerCase(),
       telefono?.trim() || null, notas?.trim() || null, 'pendiente']
    );
    res.status(201).json({ id: result.insertId, message: '¡Registro exitoso!' });
  } catch { res.status(500).json({ error: 'Error al registrar' }); }
});

// ── ADMIN — EVENTOS ───────────────────────────────────────────────────────────

router.get('/admin/eventos', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
              e.lugar, e.link, e.capacidad, e.imagen_url, e.activo, e.fecha_creacion,
              a.nombre AS creado_por_nombre,
              COUNT(r.id) AS registrados,
              SUM(r.estado='confirmado') AS confirmados,
              SUM(r.estado='pendiente') AS pendientes,
              SUM(r.estado='cancelado') AS cancelados
       FROM luma_eventos e
       LEFT JOIN luma_admins a ON e.creado_por = a.id
       LEFT JOIN luma_registros r ON r.evento_id = e.id
       GROUP BY e.id ORDER BY e.fecha DESC, e.hora_inicio ASC`
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
    const activo = (b.activo === false || b.activo === '0' || b.activo === 0) ? 0 : 1;

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
    const activo = (b.activo === false || b.activo === '0' || b.activo === 0) ? 0 : 1;

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
    const [r] = await pool.execute('DELETE FROM luma_eventos WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch { res.status(500).json({ error: 'Error al eliminar evento' }); }
});

// ── ADMIN — REGISTROS ─────────────────────────────────────────────────────────

router.get('/admin/eventos/:id/registros', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nombre, email, telefono, notas, estado, fecha_registro FROM luma_registros WHERE evento_id = ? ORDER BY fecha_registro ASC',
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
    const [[{ proximos }]] = await pool.execute('SELECT COUNT(*) AS proximos FROM luma_eventos WHERE activo = 1 AND fecha >= CURDATE()');
    res.json({ total_eventos, total_registros, confirmados, proximos });
  } catch { res.status(500).json({ error: 'Error al obtener stats' }); }
});

// ── ADMIN — ADMINISTRADORES ───────────────────────────────────────────────────

router.get('/admin/admins', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.nombre, a.usuario, a.email, a.protegido, a.activo, a.fecha_creacion,
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
    const { nombre, usuario, email, password, rol_id, activo } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!usuario?.trim()) return res.status(400).json({ error: 'El usuario es obligatorio' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    if (!rol_id) return res.status(400).json({ error: 'El rol es obligatorio' });

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO luma_admins (nombre, usuario, email, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre.trim(), usuario.trim(), email?.trim() || null, hash, rol_id, activo === false || activo === '0' ? 0 : 1]
    );
    res.status(201).json({ id: result.insertId, message: 'Administrador creado' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El usuario ya está registrado' });
    res.status(500).json({ error: 'Error al crear administrador' });
  }
});

router.put('/admin/admins/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [target] = await pool.execute('SELECT protegido FROM luma_admins WHERE id = ?', [req.params.id]);
    if (!target[0]) return res.status(404).json({ error: 'Administrador no encontrado' });
    if (target[0].protegido && req.user.protegido !== 1)
      return res.status(403).json({ error: 'No puedes modificar al administrador protegido' });

    const { nombre, usuario, email, password, rol_id, activo } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!usuario?.trim()) return res.status(400).json({ error: 'El usuario es obligatorio' });
    if (!rol_id) return res.status(400).json({ error: 'El rol es obligatorio' });

    const bcrypt = require('bcryptjs');
    if (password && password.length > 0) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      const hash = await bcrypt.hash(password, 12);
      await pool.execute(
        'UPDATE luma_admins SET nombre=?, usuario=?, email=?, password_hash=?, rol_id=?, activo=? WHERE id=?',
        [nombre.trim(), usuario.trim(), email?.trim() || null, hash, rol_id, activo === false || activo === '0' ? 0 : 1, req.params.id]
      );
    } else {
      await pool.execute(
        'UPDATE luma_admins SET nombre=?, usuario=?, email=?, rol_id=?, activo=? WHERE id=?',
        [nombre.trim(), usuario.trim(), email?.trim() || null, rol_id, activo === false || activo === '0' ? 0 : 1, req.params.id]
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
