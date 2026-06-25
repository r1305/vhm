const { Router } = require('express');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');

const router = Router();
const t = (v, max=5000) => v == null ? null : String(v).trim().slice(0, max) || null;

// Solo el terapeuta dueño o superadmin puede leer/escribir
async function checkAccess(req, res, pacienteId) {
  if (['superadmin','recepcion'].includes(req.user.rol)) return true;
  const [[p]] = await pool.execute('SELECT terapeuta_id FROM pacientes WHERE id=?', [pacienteId]);
  if (p?.terapeuta_id !== req.user.id) {
    res.status(403).json({ error: 'Sin acceso al historial de este paciente' });
    return false;
  }
  return true;
}

router.get('/paciente/:pid', auth, async (req, res) => {
  if (!(await checkAccess(req, res, req.params.pid))) return;
  const [rows] = await pool.execute(
    `SELECT h.*, t.nombre AS terapeuta_nombre
     FROM historial_clinico h JOIN terapeutas t ON h.terapeuta_id=t.id
     WHERE h.paciente_id=? ORDER BY h.fecha DESC, h.created_at DESC`,
    [req.params.pid]
  );
  res.json(rows);
});

router.post('/paciente/:pid', auth, async (req, res) => {
  if (!(await checkAccess(req, res, req.params.pid))) return;
  const { nota, tipo='evolucion', cita_id, fecha } = req.body || {};
  if (!nota) return res.status(400).json({ error: 'nota requerida' });
  const [r] = await pool.execute(
    `INSERT INTO historial_clinico (paciente_id,terapeuta_id,cita_id,fecha,nota,tipo)
     VALUES (?,?,?,?,?,?)`,
    [req.params.pid, req.user.id, cita_id||null, fecha||new Date().toISOString().slice(0,10), t(nota), tipo]
  );
  res.status(201).json({ id: r.insertId });
});

router.delete('/:id', auth, async (req, res) => {
  if (req.user.rol !== 'superadmin') return res.status(403).json({ error: 'Solo superadmin' });
  await pool.execute('DELETE FROM historial_clinico WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
