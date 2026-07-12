const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin } = require('../lib/auth');

const router = Router();
const s = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;
const pid = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; };

/* ── Helper: asignación automática de terapeuta ─────────────── */
async function autoAsignar(motivo) {
  if (!motivo) return null;
  const texto = motivo.toLowerCase();
  const [reglas] = await pool.execute(
    'SELECT terapeuta_id, keyword FROM asignacion_reglas WHERE activo=1 ORDER BY prioridad ASC'
  );
  for (const r of reglas) {
    if (texto.includes(r.keyword.toLowerCase())) return r.terapeuta_id;
  }
  // Fallback: terapeuta activo con menos leads en los últimos 30 días
  const [[menos]] = await pool.execute(`
    SELECT t.id FROM terapeutas t
    LEFT JOIN leads l ON l.terapeuta_id = t.id AND l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    WHERE t.activo = 1 AND t.rol = 'terapeuta'
    GROUP BY t.id ORDER BY COUNT(l.id) ASC LIMIT 1
  `);
  return menos?.id || null;
}

// ── CRUD leads (autenticado) ──────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const estado = s(req.query.estado, 20);
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    if (estado) { sql += ' AND estado=?'; params.push(estado); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, fuente = 'web',
            fuente_detalle, mensaje, terapeuta_id,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body || {};
    const tid = pid(terapeuta_id) || await autoAsignar(mensaje);
    const [r] = await pool.execute(
      `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,mensaje,
        terapeuta_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s(nombre,120), s(apellido,120), s(email,150), s(telefono,30),
       fuente, s(fuente_detalle,300), s(mensaje,2000),
       tid, s(utm_source,200), s(utm_medium,200), s(utm_campaign,200), s(utm_content,200), s(utm_term,200)]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, fuente, fuente_detalle, mensaje, estado, notas } = req.body || {};
    await pool.execute(
      `UPDATE leads SET nombre=?,apellido=?,email=?,telefono=?,fuente=?,
       fuente_detalle=?,mensaje=?,estado=?,notas=? WHERE id=?`,
      [s(nombre,120), s(apellido,120), s(email,150), s(telefono,30),
       fuente, s(fuente_detalle,300), s(mensaje,2000), estado, s(notas,2000), req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/estado', auth, async (req, res) => {
  try {
    await pool.execute('UPDATE leads SET estado=? WHERE id=?', [req.body.estado, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/convertir', auth, async (req, res) => {
  try {
    const [[lead]] = await pool.execute('SELECT * FROM leads WHERE id=?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
    const [r] = await pool.execute(
      `INSERT INTO pacientes (nombre,apellido,email,telefono,fuente,fuente_detalle,terapeuta_id,estado)
       VALUES (?,?,?,?,?,?,?,'prospecto')`,
      [lead.nombre, lead.apellido, lead.email, lead.telefono,
       lead.fuente, lead.fuente_detalle, lead.terapeuta_id || req.user.id]
    );
    await pool.execute('UPDATE leads SET estado=?,paciente_id=? WHERE id=?',
      ['convertido', r.insertId, lead.id]);
    res.json({ paciente_id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reglas de asignación automática ──────────────────────────
router.get('/reglas', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT r.*, t.nombre AS terapeuta_nombre, t.apellido AS terapeuta_apellido
      FROM asignacion_reglas r JOIN terapeutas t ON r.terapeuta_id = t.id
      ORDER BY r.prioridad ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reglas', authAdmin, async (req, res) => {
  try {
    const { terapeuta_id, keyword, prioridad = 1 } = req.body || {};
    if (!terapeuta_id || !keyword) return res.status(400).json({ error: 'terapeuta_id y keyword requeridos' });
    const [r] = await pool.execute(
      'INSERT INTO asignacion_reglas (terapeuta_id, keyword, prioridad) VALUES (?,?,?)',
      [pid(terapeuta_id), s(keyword, 100), prioridad]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/reglas/:id', authAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM asignacion_reglas WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Webhooks públicos ─────────────────────────────────────────
router.get('/webhook/meta', (req, res) => {
  const token = req.query['hub.verify_token'];
  if (token && token === process.env.META_WEBHOOK_VERIFY_TOKEN)
    return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

function verifyMetaSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !process.env.META_APP_SECRET) return false;
  const expected = 'sha256=' + require('crypto').createHmac('sha256', process.env.META_APP_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  try { return require('crypto').timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

router.post('/webhook/meta', async (req, res) => {
  console.log('[webhook] POST recibido body keys:', Object.keys(req.body || {}).join(','));
  res.sendStatus(200);
  if (!verifyMetaSignature(req)) {
    console.log('[webhook] FIRMA INVALIDA');
    return;
  }
  console.log('[webhook] Firma OK');
  if (req.body.object !== 'page') {
    console.log('[webhook] object no es page:', req.body.object);
    return;
  }
  console.log('[webhook] object=page OK');
  for (const entry of req.body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = change.value?.leadgen_id;
      console.log('[webhook] leadgen_id:', leadgenId);
      if (!leadgenId || !process.env.META_PAGE_ACCESS_TOKEN) {
        console.log('[webhook] Falta leadgenId o token');
        continue;
      }
      try {
        const url = `https://graph.facebook.com/v22.0/${leadgenId}?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`;
        console.log('[webhook] Fetching Graph API...');
        const r = await fetch(url);
        const data = await r.json();
        console.log('[webhook] Graph API status:', r.status, 'has error:', !!data.error);
        if (!r.ok) { console.log('[webhook] Graph API fallo:', data.error?.message); continue; }
        const f = {};
        for (const field of data.field_data || []) f[field.name] = field.values?.[0] || '';
        const tid = await autoAsignar(f.message || f.motivo_consulta || '');
        const [r2] = await pool.execute(
          `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,mensaje,
            terapeuta_id,utm_source,utm_campaign,utm_content)
           VALUES (?,?,?,?,'instagram',?,?,?,?,?,?)`,
          [s(f.first_name || f.full_name?.split(' ')[0], 120),
           s(f.last_name  || f.full_name?.split(' ').slice(1).join(' '), 120),
           s(f.email, 150), s(f.phone_number || f.phone, 30),
           `Form:${data.form_id||''} Ad:${data.ad_id||''}`,
           s(f.message || f.mensaje, 2000),
           tid,
           s(data.ad_name, 200), s(data.form_name, 200), s(data.ad_id, 200)]
        );
        console.log('[webhook] Lead INSERTADO id:', r2.insertId);
      } catch (err) { console.error('[crm/meta]', err.message); }
    }
  }
});

function verifyTikTokSignature(req) {
  const signature = req.headers['x-tiktok-webhook-signature'];
  if (!signature || !process.env.TIKTOK_APP_SECRET) return false;
  const expected = require('crypto').createHmac('sha256', process.env.TIKTOK_APP_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  try { return require('crypto').timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

router.post('/webhook/tiktok', async (req, res) => {
  res.sendStatus(200);
  if (!verifyTikTokSignature(req)) return;
  const events = Array.isArray(req.body) ? req.body : [req.body];
  for (const ev of events) {
    if (ev.type !== 'LEAD_SUBMITTED') continue;
    const f = {};
    for (const field of ev.lead_fields || []) f[field.name?.toLowerCase()] = field.value || '';
    try {
      const tid = await autoAsignar(f.message || f.motivo || '');
      await pool.execute(
        `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,
          terapeuta_id,utm_source,utm_campaign,utm_content)
         VALUES (?,?,?,?,'tiktok',?,?,?,?,?)`,
        [s(f.first_name || f.name?.split(' ')[0] || 'Lead TikTok', 120),
         s(f.last_name  || f.name?.split(' ').slice(1).join(' '), 120),
         s(f.email, 150), s(f.phone_number || f.phone, 30),
         `Form:${ev.form_id||''}`,
         tid,
         'tiktok', s(ev.campaign_name, 200), s(ev.ad_name || ev.form_id, 200)]
      );
    } catch (err) { console.error('[crm/tiktok]', err.message); }
  }
});

// ── Formulario web con UTM ────────────────────────────────────
router.post('/web', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, mensaje,
            fuente_detalle, motivo_consulta,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    if (email) {
      const [[ex]] = await pool.execute('SELECT id FROM leads WHERE email=? AND fuente="web" LIMIT 1', [email]);
      if (ex) {
        await pool.execute('UPDATE leads SET updated_at=NOW() WHERE id=?', [ex.id]);
        return res.json({ ok: true, id: ex.id, nuevo: false });
      }
    }

    const tid = await autoAsignar(motivo_consulta || mensaje || '');
    const [r] = await pool.execute(
      `INSERT INTO leads (nombre,apellido,email,telefono,fuente,fuente_detalle,mensaje,
        terapeuta_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term)
       VALUES (?,?,?,?,'web',?,?,?,?,?,?,?,?)`,
      [s(nombre,120), s(apellido,120), s(email,150), s(telefono,30),
       s(fuente_detalle || utm_source, 300), s(mensaje || motivo_consulta, 2000),
       tid,
       s(utm_source,200), s(utm_medium,200), s(utm_campaign,200), s(utm_content,200), s(utm_term,200)]
    );
    res.status(201).json({ ok: true, id: r.insertId, nuevo: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
