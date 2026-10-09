const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin, ownerFilter } = require('../lib/auth');
const { isStaffAdmin } = require('../lib/roles');

const router = Router();
const t = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const id = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };
const tribuProvision = require('../lib/tribuProvision');
const { normalizeDiasSiguienteCuota } = require('../lib/cuotasPlan');
const {
  loadPacientePaquetes,
  createPacientePaquete,
  deletePacientePaquete,
  markCuotaPagada,
  syncCuotasForPaquete,
  getSesionesResumen,
  addDays,
  SQL,
} = require('../lib/paquetesPaciente');

router.get('/conteo-por-terapeuta', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT terapeuta_id, COUNT(*) AS total FROM pacientes WHERE terapeuta_id IS NOT NULL GROUP BY terapeuta_id'
    );
    const map = {};
    rows.forEach(r => { map[r.terapeuta_id] = r.total; });
    res.json(map);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.get('/', auth, async (req, res) => {
  try {
    const q = t(req.query.q, 80);
    const estado = t(req.query.estado, 20);
    const tid = id(req.query.terapeuta_id);
    const sinTel   = req.query.sin_telefono === '1';
    const sinEmail = req.query.sin_email    === '1';
    const limit = Math.min(id(req.query.limit) || 50, 500);
    const offset = Math.max(id(req.query.offset) || 0, 0);
    const of = ownerFilter(req, 'p');
    let sql = `SELECT p.*, t.nombre AS terapeuta_nombre,
               ${SQL.sesionesTotal('p')}      AS sesiones_total,
               ${SQL.citasConfirmadas('p')}   AS citas_confirmadas,
               ${SQL.sesionesPendientes('p')} AS sesiones_pendientes,
               ${SQL.paqueteNombre('p')}      AS paquete_nombre,
               (SELECT COUNT(*) FROM paciente_paquetes pp WHERE pp.paciente_id = p.id) AS paquetes_total
               FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id WHERE 1=1`;
    const params = [];
    if (q) { sql += ' AND (p.nombre LIKE ? OR p.apellido LIKE ? OR p.email LIKE ? OR p.telefono LIKE ?)'; const l=`%${q}%`; params.push(l,l,l,l); }
    if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
    if (tid)    { sql += ' AND p.terapeuta_id = ?'; params.push(tid); }
    if (sinTel)   sql += ' AND (p.telefono IS NULL OR p.telefono = "")';
    if (sinEmail) sql += ' AND (p.email IS NULL OR p.email = "")';
    sql += of.sql; params.push(...of.params);
    sql += ' ORDER BY p.updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows] = await pool.execute(sql, params);
    try {
      await tribuProvision.attachTribuFlagsToPacientes(rows);
    } catch {
      rows.forEach(p => { p.tribu_user_id = null; });
    }
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error al listar pacientes' }); }
});

router.post('/tribu/rebuild-suscripciones', authAdmin, async (req, res) => {
  try {
    const result = await tribuProvision.rebuildAllTribuSubscriptions();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al reconstruir suscripciones' });
  }
});

router.post('/:pid/tribu-usuario', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const [[p]] = await pool.execute('SELECT * FROM pacientes WHERE id = ?', [pid]);
    if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (p.email) {
      const existing = await tribuProvision.findTribuUserByEmail(p.email);
      if (existing) return res.status(409).json({ error: 'Este paciente ya tiene usuario Tribu' });
    }
    const result = await tribuProvision.createTribuUserFromPaciente(p);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    const code = err.message?.includes('Ya existe') ? 409 : 500;
    res.status(code).json({ error: err.message || 'Error al crear usuario Tribu' });
  }
});

router.post('/', authAdmin, async (req, res) => {
  const { nombre, apellido, email, telefono, fecha_nacimiento, genero,
          motivo_consulta, fuente, fuente_detalle, terapeuta_id, estado = 'prospecto' } = req.body || {};
  if (!nombre || !apellido) return res.status(400).json({ error: 'nombre y apellido requeridos' });
  try {
    const tid = id(terapeuta_id) || (req.user.rol === 'terapeuta' ? req.user.id : null);
    const [r] = await pool.execute(
      `INSERT INTO pacientes (nombre,apellido,email,telefono,fecha_nacimiento,genero,
        motivo_consulta,fuente,fuente_detalle,terapeuta_id,estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       fecha_nacimiento||null, genero||null,
       t(motivo_consulta,2000),t(fuente,80),t(fuente_detalle,300),tid,estado]
    );
    res.status(201).json({ id: r.insertId });
  } catch { res.status(500).json({ error: 'Error al crear paciente' }); }
});

router.get('/:pid', auth, async (req, res) => {
  try {
    const pid = id(req.params.pid);
    if (!pid) return res.status(400).json({ error: 'ID inválido' });
    if (!await puedeVerPaciente(req, pid)) return res.status(403).json({ error: 'Sin acceso' });
    const [[p]] = await pool.execute(
      `SELECT p.*, t.nombre AS terapeuta_nombre, t.apellido AS terapeuta_apellido
       FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id WHERE p.id = ?`,
      [pid]
    );
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    res.json(p);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.put('/:pid', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, apellido, email, telefono, fecha_nacimiento, genero,
          motivo_consulta, fuente, fuente_detalle, terapeuta_id, estado } = req.body || {};
  try {
    await pool.execute(
      `UPDATE pacientes SET nombre=?,apellido=?,email=?,telefono=?,fecha_nacimiento=?,genero=?,
       motivo_consulta=?,fuente=?,fuente_detalle=?,terapeuta_id=?,estado=?
       WHERE id=?`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       fecha_nacimiento||null, genero||null,
       t(motivo_consulta,2000),t(fuente,80),t(fuente_detalle,300),
       id(terapeuta_id),estado,pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
});

async function puedeVerPaciente(req, pid) {
  if (isStaffAdmin(req.user?.rol)) return true;
  const [[p]] = await pool.execute(
    'SELECT 1 AS ok FROM pacientes WHERE id = ? AND terapeuta_id = ?', [pid, req.user.id]
  );
  return !!p;
}

async function authPaciente(req, res, next) {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  if (!await puedeVerPaciente(req, pid)) return res.status(403).json({ error: 'Sin acceso' });
  req.pid = pid; // Attach pid for later use
  next();
}

// ── Resumen de sesiones (histórico completo, independiente del estado del paquete) ──
router.get('/:pid/sesiones-resumen', auth, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    if (!await puedeVerPaciente(req, pid)) return res.status(403).json({ error: 'Sin acceso' });
    res.json(await getSesionesResumen(pid));
  } catch { res.status(500).json({ error: 'Error' }); }
});

// ── Paquetes adquiridos por paciente ──────────────────────────
router.get('/:pid/paquetes-adquiridos', auth, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    if (!await puedeVerPaciente(req, pid)) return res.status(403).json({ error: 'Sin acceso' });
    const paquetes = await loadPacientePaquetes(pid);
    res.json(paquetes);
  } catch {
    res.status(500).json({ error: 'Error al cargar paquetes' });
  }
});

router.post('/:pid/paquetes-adquiridos', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  if (!pid) return res.status(400).json({ error: 'ID inválido' });
  try {
    const paqueteId = await createPacientePaquete(pid, req.body || {});
    const paquetes = await loadPacientePaquetes(pid);
    res.status(201).json({ id: paqueteId, paquetes });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al asignar paquete' });
  }
});

router.patch('/:pid/paquetes-adquiridos/:pkgId', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  const pkgId = id(req.params.pkgId);
  if (!pid || !pkgId) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, fecha_inicio, sesiones, precio, paquete_catalogo_id } = req.body || {};
  try {
    const [[pkg]] = await pool.execute(
      'SELECT * FROM paciente_paquetes WHERE id = ? AND paciente_id = ?', [pkgId, pid]
    );
    if (!pkg) return res.status(404).json({ error: 'Paquete no encontrado' });
    const catalogoId = paquete_catalogo_id != null ? id(paquete_catalogo_id) : null;
    const fields = [];
    const vals = [];
    let needsSync = false;

    if (catalogoId) {
      const [[cat]] = await pool.execute('SELECT * FROM paquetes_catalogo WHERE id = ?', [catalogoId]);
      if (!cat) return res.status(400).json({ error: 'Paquete de catálogo no encontrado' });
      if (!(Number(cat.precio) > 0)) {
        return res.status(400).json({ error: `El paquete "${cat.nombre}" no tiene precio en el catálogo` });
      }
      const fi = fecha_inicio != null ? fecha_inicio : String(pkg.fecha_inicio).slice(0, 10);
      const diasSiguienteCuota = normalizeDiasSiguienteCuota(cat.dias_siguiente_cuota);
      const venceAt = addDays(fi, parseInt(cat.validez_dias, 10) || 30);
      fields.push(
        'paquete_catalogo_id = ?', 'nombre = ?', 'sesiones = ?', 'validez_dias = ?',
        'dias_siguiente_cuota = ?', 'accede_comunidad = ?', 'precio = ?',
        'fecha_inicio = ?', 'vence_at = ?'
      );
      vals.push(
        catalogoId,
        cat.nombre,
        parseInt(cat.sesiones, 10) || 1,
        cat.validez_dias,
        diasSiguienteCuota,
        cat.accede_comunidad ? 1 : 0,
        Math.max(0, Number(cat.precio) || 0),
        fi,
        venceAt
      );
      needsSync = true;
    } else {
      if (nombre != null)       { fields.push('nombre = ?');       vals.push(t(nombre, 200)); }
      if (fecha_inicio != null) { fields.push('fecha_inicio = ?'); vals.push(fecha_inicio); needsSync = true; }
      if (sesiones != null)     { fields.push('sesiones = ?');     vals.push(Math.max(1, parseInt(sesiones, 10) || 1)); needsSync = true; }
      if (precio != null) {
        const nuevoPrecio = Number(precio);
        if (!(nuevoPrecio > 0)) return res.status(400).json({ error: 'El precio del paquete debe ser mayor a 0' });
        fields.push('precio = ?'); vals.push(Math.round(nuevoPrecio * 100) / 100); needsSync = true;
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(pkgId);
    await pool.execute(`UPDATE paciente_paquetes SET ${fields.join(', ')} WHERE id = ?`, vals);
    if (needsSync) {
      await syncCuotasForPaquete(pkgId);
    }
    const paquetes = await loadPacientePaquetes(pid);
    res.json({ ok: true, paquetes });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar paquete' });
  }
});

router.delete('/:pid/paquetes-adquiridos/:pkgId', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  const pkgId = id(req.params.pkgId);
  if (!pid || !pkgId) return res.status(400).json({ error: 'ID inválido' });
  try {
    await deletePacientePaquete(pid, pkgId);
    const paquetes = await loadPacientePaquetes(pid);
    res.json({ ok: true, paquetes });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al eliminar paquete' });
  }
});

router.patch('/:pid/paquetes-adquiridos/cuotas/:cuotaId/pagar', authAdmin, async (req, res) => {
  const pid = id(req.params.pid);
  const cuotaId = id(req.params.cuotaId);
  if (!pid || !cuotaId) return res.status(400).json({ error: 'ID inválido' });
  try {
    await markCuotaPagada(pid, cuotaId);
    const paquetes = await loadPacientePaquetes(pid);
    res.json({ ok: true, paquetes });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al registrar pago' });
  }
});

router.get('/:pid/sesiones', auth, authPaciente, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM paciente_sesiones WHERE paciente_id=? ORDER BY fecha_inicio ASC, id ASC',
      [req.pid]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

router.post('/:pid/sesiones', auth, authPaciente, async (req, res) => {
  const { fecha_inicio, sesiones } = req.body || {};
  try {
    const [r] = await pool.execute(
      'INSERT INTO paciente_sesiones (paciente_id, fecha_inicio, sesiones) VALUES (?,?,?)',
      [req.pid, fecha_inicio||null, parseInt(sesiones,10)||0]
    );
    res.status(201).json({ id: r.insertId });
  } catch { res.status(500).json({ error: 'Error al crear' }); }
});

router.put('/:pid/sesiones/:sid', auth, authPaciente, async (req, res) => {
  const sid = id(req.params.sid);
  if (!sid) return res.status(400).json({ error: 'ID inválido' });
  const { fecha_inicio, sesiones } = req.body || {};
  try {
    await pool.execute(
      'UPDATE paciente_sesiones SET fecha_inicio=?, sesiones=? WHERE id=? AND paciente_id=?',
      [fecha_inicio||null, parseInt(sesiones,10)||0, sid, req.pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al actualizar' }); }
});

router.delete('/:pid/sesiones/:sid', auth, authPaciente, async (req, res) => {
  const sid = id(req.params.sid);
  if (!sid) return res.status(400).json({ error: 'ID inválido' });
  try {
    await pool.execute(
      'DELETE FROM paciente_sesiones WHERE id=? AND paciente_id=?',
      [sid, req.pid]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al eliminar' }); }
});

module.exports = router;
