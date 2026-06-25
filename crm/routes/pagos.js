const { Router } = require('express');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');

const router = Router();
const t = (v,max=255) => v==null?null:String(v).trim().slice(0,max)||null;
const pid = (v) => { const n=parseInt(v,10); return isFinite(n)&&n>0?n:null; };

router.get('/', auth, async (req, res) => {
  const paciente = pid(req.query.paciente_id);
  let sql = 'SELECT pg.*, p.nombre AS paciente_nombre FROM pagos pg JOIN pacientes p ON pg.paciente_id=p.id WHERE 1=1';
  const params = [];
  if (paciente) { sql += ' AND pg.paciente_id=?'; params.push(paciente); }
  sql += ' ORDER BY pg.created_at DESC LIMIT 200';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

router.post('/', auth, async (req, res) => {
  const { paciente_id, cita_id, monto, moneda='PEN', metodo='transferencia',
          referencia, notas, estado='completado' } = req.body || {};
  if (!paciente_id || !monto) return res.status(400).json({ error: 'paciente_id y monto requeridos' });
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
  let sql = 'SELECT * FROM packs WHERE 1=1';
  const params = [];
  if (paciente) { sql += ' AND paciente_id=?'; params.push(paciente); }
  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

router.post('/packs', auth, async (req, res) => {
  const { paciente_id, nombre, sesiones_total=4, monto_total, vence_at } = req.body || {};
  if (!paciente_id || !monto_total) return res.status(400).json({ error: 'Campos requeridos' });
  const [r] = await pool.execute(
    `INSERT INTO packs (paciente_id,nombre,sesiones_total,monto_total,vence_at)
     VALUES (?,?,?,?,?)`,
    [pid(paciente_id),t(nombre,120),sesiones_total,monto_total,vence_at||null]
  );
  res.status(201).json({ id: r.insertId });
});

router.patch('/packs/:id/usar', auth, async (req, res) => {
  await pool.execute(
    'UPDATE packs SET sesiones_usadas=sesiones_usadas+1 WHERE id=? AND activo=1',
    [req.params.id]
  );
  res.json({ ok: true });
});

module.exports = router;
