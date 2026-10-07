const { Router } = require('express');
const pool = require('../lib/db');
const { auth, ownerFilter } = require('../lib/auth');
const { isStaffAdmin } = require('../lib/roles');

const router = Router();
const t = (v,max=255) => v==null?null:String(v).trim().slice(0,max)||null;
const pid = (v) => { const n=parseInt(v,10); return isFinite(n)&&n>0?n:null; };

// Guardrail IDOR (A6): un terapeuta solo opera pagos de SUS pacientes.
// Devuelve false y responde 403 si el paciente no le pertenece.
async function puedeOperarPaciente(req, res, pacienteId) {
  if (isStaffAdmin(req.user.rol)) return true;
  const [[p]] = await pool.execute('SELECT terapeuta_id FROM pacientes WHERE id=?', [pacienteId]);
  if (p?.terapeuta_id !== req.user.id) {
    res.status(403).json({ error: 'Sin acceso a este paciente' });
    return false;
  }
  return true;
}

router.get('/', auth, async (req, res) => {
  const paciente = pid(req.query.paciente_id);
  let sql = 'SELECT pg.*, p.nombre AS paciente_nombre FROM pagos pg JOIN pacientes p ON pg.paciente_id=p.id WHERE 1=1';
  const params = [];
  if (paciente) { sql += ' AND pg.paciente_id=?'; params.push(paciente); }
  const of = ownerFilter(req, 'p');
  sql += of.sql; params.push(...of.params);
  sql += ' ORDER BY pg.created_at DESC LIMIT 200';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

router.post('/', auth, async (req, res) => {
  const { paciente_id, cita_id, monto, moneda='PEN', metodo='transferencia',
          referencia, notas, estado='completado' } = req.body || {};
  if (!paciente_id || !monto) return res.status(400).json({ error: 'paciente_id y monto requeridos' });
  if (!(await puedeOperarPaciente(req, res, pid(paciente_id)))) return;
  const [r] = await pool.execute(
    `INSERT INTO pagos (paciente_id,cita_id,monto,moneda,metodo,estado,referencia,notas)
     VALUES (?,?,?,?,?,?,?,?)`,
    [pid(paciente_id),pid(cita_id),monto,moneda,metodo,estado,t(referencia,100),t(notas,500)]
  );
  if (cita_id && estado === 'completado') {
    await pool.execute('UPDATE citas SET pagado=1 WHERE id=?', [pid(cita_id)]);
  }
  res.status(201).json({ id: r.insertId });
});

// Packs de sesiones
router.get('/packs', auth, async (req, res) => {
  const paciente = pid(req.query.paciente_id);
  let sql = 'SELECT pk.* FROM packs pk LEFT JOIN pacientes p ON pk.paciente_id=p.id WHERE 1=1';
  const params = [];
  if (paciente) { sql += ' AND pk.paciente_id=?'; params.push(paciente); }
  const of = ownerFilter(req, 'p');
  sql += of.sql; params.push(...of.params);
  sql += ' ORDER BY pk.created_at DESC';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

router.post('/packs', auth, async (req, res) => {
  const { paciente_id, nombre, sesiones_total=4, monto_total, vence_at } = req.body || {};
  if (!paciente_id || !monto_total) return res.status(400).json({ error: 'Campos requeridos' });
  if (!(await puedeOperarPaciente(req, res, pid(paciente_id)))) return;
  const [r] = await pool.execute(
    `INSERT INTO packs (paciente_id,nombre,sesiones_total,monto_total,vence_at)
     VALUES (?,?,?,?,?)`,
    [pid(paciente_id),t(nombre,120),sesiones_total,monto_total,vence_at||null]
  );
  res.status(201).json({ id: r.insertId });
});

router.patch('/packs/:id/usar', auth, async (req, res) => {
  const id = pid(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const [[pack]] = await pool.execute('SELECT paciente_id FROM packs WHERE id=?', [id]);
  if (!pack) return res.status(404).json({ error: 'Pack no encontrado' });
  if (!(await puedeOperarPaciente(req, res, pack.paciente_id))) return;
  await pool.execute(
    'UPDATE packs SET sesiones_usadas=sesiones_usadas+1 WHERE id=? AND activo=1',
    [id]
  );
  res.json({ ok: true });
});

module.exports = router;
