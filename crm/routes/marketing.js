const { Router } = require('express');
const pool = require('../lib/db');
const { auth, authAdmin } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');

const router = Router();
const s = (v, max = 255) => v == null ? null : String(v).trim().slice(0, max) || null;

// ── Suscriptores ──────────────────────────────────────────────
router.get('/suscriptores', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM suscriptores ORDER BY created_at DESC LIMIT 500'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Suscripción pública desde vhm.com.pe
router.post('/suscribir', async (req, res) => {
  try {
    const { email, nombre, segmento } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email inválido' });
    await pool.execute(
      `INSERT INTO suscriptores (email, nombre, segmento, ip_origen)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE activo=1, nombre=COALESCE(VALUES(nombre),nombre)`,
      [s(email,150), s(nombre,120), s(segmento,80), req.ip || null]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/suscriptores/:id', authAdmin, async (req, res) => {
  try {
    await pool.execute('UPDATE suscriptores SET activo=0 WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Campañas ──────────────────────────────────────────────────
router.get('/campanas', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM campanas_email ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campanas', authAdmin, async (req, res) => {
  try {
    const { nombre, asunto, cuerpo_html, segmento } = req.body || {};
    if (!nombre || !asunto || !cuerpo_html)
      return res.status(400).json({ error: 'nombre, asunto y cuerpo_html requeridos' });
    const [r] = await pool.execute(
      `INSERT INTO campanas_email (nombre, asunto, cuerpo_html, segmento, propietario_id)
       VALUES (?, ?, ?, ?, ?)`,
      [s(nombre,200), s(asunto,300), cuerpo_html, s(segmento,80), req.user.id]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/campanas/:id', authAdmin, async (req, res) => {
  try {
    const { nombre, asunto, cuerpo_html, segmento } = req.body || {};
    await pool.execute(
      'UPDATE campanas_email SET nombre=?,asunto=?,cuerpo_html=?,segmento=? WHERE id=?',
      [s(nombre,200), s(asunto,300), cuerpo_html, s(segmento,80), req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/campanas/:id', authAdmin, async (req, res) => {
  try {
    await pool.execute("DELETE FROM campanas_email WHERE id=? AND estado='borrador'", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Enviar campaña
router.post('/campanas/:id/enviar', authAdmin, async (req, res) => {
  try {
    const [[camp]] = await pool.execute('SELECT * FROM campanas_email WHERE id=?', [req.params.id]);
    if (!camp) return res.status(404).json({ error: 'Campaña no encontrada' });
    if (camp.estado !== 'borrador') return res.status(400).json({ error: 'Solo se pueden enviar campañas en borrador' });

    const where = camp.segmento ? 'AND segmento=?' : '';
    const params = camp.segmento ? [camp.segmento] : [];
    const [suscriptores] = await pool.execute(
      `SELECT email, nombre FROM suscriptores WHERE activo=1 ${where}`,
      params
    );

    if (!suscriptores.length) return res.status(400).json({ error: 'Sin suscriptores en el segmento' });

    await pool.execute("UPDATE campanas_email SET estado='enviando' WHERE id=?", [camp.id]);
    res.json({ ok: true, total: suscriptores.length, message: 'Envío iniciado en segundo plano' });

    // Enviar en segundo plano
    (async () => {
      let enviados = 0;
      try {
        for (const sub of suscriptores) {
          try {
            const html = camp.cuerpo_html.replace(/\{\{nombre\}\}/gi, sub.nombre || 'amigo/a');
            await sendMail({ to: sub.email, subject: camp.asunto, html });
            enviados++;
          } catch (e) { console.error('[crm/campana]', sub.email, e.message); }
          await new Promise(r => setTimeout(r, 200)); // 5 emails/seg
        }
        await pool.execute(
          "UPDATE campanas_email SET estado='completada', total_enviados=?, enviada_at=NOW() WHERE id=?",
          [enviados, camp.id]
        );
        console.log(`[crm/campana] ${camp.nombre}: ${enviados}/${suscriptores.length} enviados`);
      } catch (e) {
        console.error(`[crm/campana] Error en envío de ${camp.nombre}:`, e.message);
        await pool.execute(
          "UPDATE campanas_email SET estado='error', total_enviados=? WHERE id=?",
          [enviados, camp.id]
        );
      }
    })();

  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
