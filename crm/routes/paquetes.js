const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin } = require('../lib/auth');

const router = Router();
const t = (v, max = 255) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

router.get('/', auth, async (req, res) => {
  try {
    const soloActivos = req.query.activo === '1';
    const sql = soloActivos
      ? 'SELECT * FROM paquetes_catalogo WHERE activo = 1 ORDER BY nombre ASC'
      : 'SELECT * FROM paquetes_catalogo ORDER BY activo DESC, nombre ASC';
    const [rows] = await pool.execute(sql);
    res.json(rows.map((r) => ({
      ...r,
      accede_comunidad: !!r.accede_comunidad,
      activo: !!r.activo,
      precio: Number(r.precio),
      sesiones: Number(r.sesiones),
      validez_dias: Number(r.validez_dias),
    })));
  } catch {
    res.status(500).json({ error: 'Error al listar paquetes' });
  }
});

router.post('/', authAdmin, async (req, res) => {
  const { nombre, sesiones, validez_dias, accede_comunidad, precio, activo } = req.body || {};
  if (!t(nombre, 120)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const ses = Math.max(1, parseInt(sesiones, 10) || 1);
  const dias = Math.max(1, parseInt(validez_dias, 10) || 30);
  try {
    const [r] = await pool.execute(
      `INSERT INTO paquetes_catalogo (nombre, sesiones, validez_dias, accede_comunidad, precio, activo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        t(nombre, 120),
        ses,
        dias,
        accede_comunidad ? 1 : 0,
        num(precio, 0),
        activo === false || activo === 0 || activo === '0' ? 0 : 1,
      ]
    );
    res.status(201).json({ id: r.insertId });
  } catch {
    res.status(500).json({ error: 'Error al crear paquete' });
  }
});

router.put('/:id', authAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, sesiones, validez_dias, accede_comunidad, precio, activo } = req.body || {};
  if (!t(nombre, 120)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    await pool.execute(
      `UPDATE paquetes_catalogo
       SET nombre = ?, sesiones = ?, validez_dias = ?, accede_comunidad = ?, precio = ?, activo = ?
       WHERE id = ?`,
      [
        t(nombre, 120),
        Math.max(1, parseInt(sesiones, 10) || 1),
        Math.max(1, parseInt(validez_dias, 10) || 30),
        accede_comunidad ? 1 : 0,
        num(precio, 0),
        activo === false || activo === 0 || activo === '0' ? 0 : 1,
        id,
      ]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al actualizar paquete' });
  }
});

router.delete('/:id', authAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const [[used]] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM paciente_paquetes WHERE paquete_catalogo_id = ?',
      [id]
    );
    if (used?.cnt > 0) {
      await pool.execute('UPDATE paquetes_catalogo SET activo = 0 WHERE id = ?', [id]);
      return res.json({ ok: true, deactivated: true });
    }
    await pool.execute('DELETE FROM paquetes_catalogo WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar paquete' });
  }
});

module.exports = router;
