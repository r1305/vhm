const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

// ── Público: listar chips activos por tipo ──
router.get('/:tipo', async (req, res) => {
  const tipo = req.params.tipo;
  if (!['intereses', 'objetivos'].includes(tipo))
    return res.status(400).json({ error: 'Tipo inválido' });
  try {
    const [rows] = await pool.execute(
      'SELECT id, label FROM tribu_catalogo_chips WHERE tipo = ? AND activo = 1 ORDER BY orden ASC, id ASC',
      [tipo]
    );
    res.json(rows.map(r => r.label));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener catálogo' }); }
});

// ── Admin: listar todos (activos e inactivos) ──
router.get('/admin/:tipo', authMiddleware, async (req, res) => {
  const tipo = req.params.tipo;
  if (!['intereses', 'objetivos'].includes(tipo))
    return res.status(400).json({ error: 'Tipo inválido' });
  try {
    const [rows] = await pool.execute(
      'SELECT id, label, orden, activo FROM tribu_catalogo_chips WHERE tipo = ? ORDER BY orden ASC, id ASC',
      [tipo]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ── Admin: crear chip ──
router.post('/admin', authMiddleware, async (req, res) => {
  const { tipo, label, orden } = req.body;
  if (!['intereses', 'objetivos'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  const labelVal = String(label || '').trim().slice(0, 80);
  if (!labelVal) return res.status(400).json({ error: 'Label requerido' });
  const ordenVal = Number.isFinite(Number(orden)) ? Number(orden) : 0;
  try {
    const [r] = await pool.execute(
      'INSERT INTO tribu_catalogo_chips (tipo, label, orden, activo) VALUES (?, ?, ?, 1)',
      [tipo, labelVal, ordenVal]
    );
    res.status(201).json({ id: r.insertId, tipo, label: labelVal, orden: ordenVal, activo: 1 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear' }); }
});

// ── Admin: actualizar chip ──
router.put('/admin/:id', authMiddleware, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
  const { label, orden, activo } = req.body;
  const sets = []; const params = [];
  if (label !== undefined) { sets.push('label = ?'); params.push(String(label).trim().slice(0, 80)); }
  if (orden !== undefined) { sets.push('orden = ?'); params.push(Number(orden) || 0); }
  if (activo !== undefined) { sets.push('activo = ?'); params.push(activo ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  params.push(id);
  try {
    await pool.execute(`UPDATE tribu_catalogo_chips SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar' }); }
});

// ── Admin: eliminar chip ──
router.delete('/admin/:id', authMiddleware, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await pool.execute('DELETE FROM tribu_catalogo_chips WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar' }); }
});

module.exports = router;
