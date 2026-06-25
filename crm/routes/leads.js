const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin } = require('../lib/auth');

const router = Router();
const t = (v, max=255) => v == null ? null : String(v).trim().slice(0,max) || null;
const pid = (v) => { const n = parseInt(v,10); return isFinite(n)&&n>0?n:null; };

// Leads (prospectos de redes + web)
router.get('/', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM leads ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

router.post('/', auth, async (req, res) => {
  const { nombre, apellido, email, telefono, fuente='web',
          fuente_detalle, mensaje, terapeuta_id } = req.body || {};
  const [r] = await pool.execute(
    `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,mensaje,terapeuta_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
     fuente,t(fuente_detalle,300),t(mensaje,2000),pid(terapeuta_id)]
  );
  res.status(201).json({ id: r.insertId });
});

router.patch('/:id/estado', auth, async (req, res) => {
  const { estado } = req.body || {};
  await pool.execute('UPDATE leads SET estado=? WHERE id=?', [estado, req.params.id]);
  res.json({ ok: true });
});

// Convertir lead → paciente
router.post('/:id/convertir', auth, async (req, res) => {
  const [[lead]] = await pool.execute('SELECT * FROM leads WHERE id=?', [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const [r] = await pool.execute(
    `INSERT INTO pacientes (nombre,apellido,email,telefono,fuente,fuente_detalle,terapeuta_id,estado)
     VALUES (?,?,?,?,?,?,?,'prospecto')`,
    [lead.nombre,lead.apellido,lead.email,lead.telefono,lead.fuente,lead.fuente_detalle,
     lead.terapeuta_id||req.user.id]
  );
  await pool.execute('UPDATE leads SET estado=?,paciente_id=? WHERE id=?',
    ['convertido', r.insertId, lead.id]);
  res.json({ paciente_id: r.insertId });
});

// Webhook público — Instagram / Meta Lead Ads
router.get('/webhook/meta', (req, res) => {
  const token = req.query['hub.verify_token'];
  if (token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

router.post('/webhook/meta', async (req, res) => {
  res.sendStatus(200);
  if (req.body.object !== 'page') return;
  for (const entry of req.body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId || !process.env.META_PAGE_ACCESS_TOKEN) continue;
      try {
        const r = await fetch(
          `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`
        );
        const data = await r.json();
        const f = {};
        for (const field of data.field_data || []) f[field.name] = field.values?.[0] || '';
        await pool.execute(
          `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,mensaje)
           VALUES (?,?,?,?,'instagram',?,?)`,
          [t(f.first_name||f.full_name?.split(' ')[0],120),
           t(f.last_name||f.full_name?.split(' ').slice(1).join(' '),120),
           t(f.email,150), t(f.phone_number||f.phone,30),
           `Form: ${data.form_id||''} Ad: ${data.ad_id||''}`,
           t(f.message||f.mensaje,2000)]
        );
      } catch (err) { console.error('[crm/meta]', err.message); }
    }
  }
});

// Webhook público — TikTok Lead Gen
router.post('/webhook/tiktok', async (req, res) => {
  res.sendStatus(200);
  const events = Array.isArray(req.body) ? req.body : [req.body];
  for (const ev of events) {
    if (ev.type !== 'LEAD_SUBMITTED') continue;
    const f = {};
    for (const field of ev.lead_fields || []) f[field.name?.toLowerCase()] = field.value || '';
    try {
      await pool.execute(
        `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle)
         VALUES (?,?,?,?,'tiktok',?)`,
        [t(f.first_name||f.name?.split(' ')[0]||'Lead TikTok',120),
         t(f.last_name||f.name?.split(' ').slice(1).join(' '),120),
         t(f.email,150), t(f.phone_number||f.phone,30),
         `Form: ${ev.form_id||''}`]
      );
    } catch (err) { console.error('[crm/tiktok]', err.message); }
  }
});

// Endpoint público — formulario web vhm.com.pe
router.post('/web', async (req, res) => {
  const { nombre, apellido, email, telefono, mensaje, fuente_detalle } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    // upsert por email
    if (email) {
      const [[ex]] = await pool.execute('SELECT id FROM leads WHERE email=? AND fuente="web" LIMIT 1', [email]);
      if (ex) {
        await pool.execute('UPDATE leads SET updated_at=NOW() WHERE id=?', [ex.id]);
        return res.json({ ok: true, id: ex.id, nuevo: false });
      }
    }
    const [r] = await pool.execute(
      `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,mensaje)
       VALUES (?,?,?,?,'web',?,?)`,
      [t(nombre,120),t(apellido,120),t(email,150),t(telefono,30),
       t(fuente_detalle,300),t(mensaje,2000)]
    );
    res.status(201).json({ ok: true, id: r.insertId, nuevo: true });
  } catch { res.status(500).json({ error: 'Error al registrar' }); }
});

module.exports = router;
