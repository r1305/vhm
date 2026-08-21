const { Router } = require('express');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');

const router = Router();
const pid = v => { const n = parseInt(v,10); return isFinite(n) && n > 0 ? n : null; };
const t   = (v, max=255) => v == null ? null : String(v).trim().slice(0,max) || null;

// GET /api/bloqueos?terapeuta_id=X&desde=Y&hasta=Z
router.get('/', auth, async (req, res) => {
  try {
    const desde = req.query.desde || new Date().toISOString().slice(0,7) + '-01';
    const hasta = req.query.hasta || new Date().toISOString().slice(0,7) + '-31';
    let sql = `SELECT b.*, t.nombre AS terapeuta_nombre, t.apellido AS terapeuta_apellido
               FROM bloqueos b JOIN terapeutas t ON b.terapeuta_id = t.id
               WHERE b.fecha_inicio <= ? AND b.fecha_fin >= ?`;
    const params = [hasta, desde];
    if (req.user.rol === 'terapeuta') {
      sql += ' AND b.terapeuta_id = ?'; params.push(req.user.id);
    } else if (req.query.terapeuta_id) {
      sql += ' AND b.terapeuta_id = ?'; params.push(pid(req.query.terapeuta_id));
    }
    sql += ' ORDER BY b.fecha_inicio';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/bloqueos
router.post('/', auth, async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, titulo = 'Bloqueado', todo_el_dia = 1 } = req.body || {};
    if (!fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'fecha_inicio y fecha_fin requeridos' });
    // Terapeuta solo puede crear para sí mismo; admin puede especificar terapeuta_id
    const terId = req.user.rol === 'terapeuta'
      ? req.user.id
      : (pid(req.body.terapeuta_id) || req.user.id);
    const [r] = await pool.execute(
      'INSERT INTO bloqueos (terapeuta_id, fecha_inicio, fecha_fin, titulo, todo_el_dia) VALUES (?,?,?,?,?)',
      [terId, fecha_inicio, fecha_fin, t(titulo,200), todo_el_dia ? 1 : 0]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/bloqueos/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const id = pid(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const [[b]] = await pool.execute('SELECT terapeuta_id FROM bloqueos WHERE id=?', [id]);
    if (!b) return res.status(404).json({ error: 'No encontrado' });
    if (req.user.rol === 'terapeuta' && b.terapeuta_id !== req.user.id)
      return res.status(403).json({ error: 'Sin acceso' });
    await pool.execute('DELETE FROM bloqueos WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
