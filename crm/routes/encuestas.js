const { Router } = require('express');
const pool = require('../lib/db');
const { uniqueSlug } = require('../lib/encuestasSlug');

const router = Router();

function requireSession(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

async function loadSurveyFull(id) {
  const [[enc]] = await pool.execute(
    'SELECT id, titulo, descripcion, slug, activa, created_at, updated_at FROM crm_encuestas WHERE id = ?',
    [id]
  );
  if (!enc) return null;
  enc.activa = !!enc.activa;
  const [preguntas] = await pool.execute(
    'SELECT id, texto, tipo, orden, obligatoria FROM crm_encuesta_preguntas WHERE encuesta_id = ? ORDER BY orden ASC, id ASC',
    [id]
  );
  for (const p of preguntas) {
    p.obligatoria = !!p.obligatoria;
    const [opciones] = await pool.execute(
      'SELECT id, texto, orden FROM crm_encuesta_opciones WHERE pregunta_id = ? ORDER BY orden ASC, id ASC',
      [p.id]
    );
    p.opciones = opciones;
  }
  enc.preguntas = preguntas;
  return enc;
}

async function saveSurveyQuestions(encuestaId, preguntas) {
  await pool.execute('DELETE FROM crm_encuesta_preguntas WHERE encuesta_id = ?', [encuestaId]);
  if (!Array.isArray(preguntas) || !preguntas.length) return;
  for (let i = 0; i < preguntas.length; i++) {
    const p = preguntas[i];
    const texto = String(p.texto || '').trim();
    if (!texto) continue;
    const tipo = ['multiple', 'text'].includes(p.tipo) ? p.tipo : 'single';
    const obligatoria = p.obligatoria !== false && p.obligatoria !== 0 ? 1 : 0;
    const [ins] = await pool.execute(
      'INSERT INTO crm_encuesta_preguntas (encuesta_id, texto, tipo, orden, obligatoria) VALUES (?, ?, ?, ?, ?)',
      [encuestaId, texto, tipo, i, obligatoria]
    );
    if (tipo === 'text') continue;
    const opciones = Array.isArray(p.opciones) ? p.opciones : [];
    let ord = 0;
    for (const op of opciones) {
      const opText = typeof op === 'string' ? op.trim() : String(op.texto || '').trim();
      if (!opText) continue;
      await pool.execute(
        'INSERT INTO crm_encuesta_opciones (pregunta_id, texto, orden) VALUES (?, ?, ?)',
        [ins.insertId, opText, ord++]
      );
    }
  }
}

// ── Público ──
router.get('/public/:slug', async (req, res) => {
  try {
    const [[row]] = await pool.execute(
      'SELECT id FROM crm_encuestas WHERE slug = ? AND activa = 1 LIMIT 1',
      [req.params.slug]
    );
    if (!row) return res.status(404).json({ error: 'Encuesta no encontrada o inactiva' });
    const enc = await loadSurveyFull(row.id);
    if (!enc.preguntas.length) return res.status(404).json({ error: 'Encuesta sin preguntas' });
    res.json({
      id: enc.id, titulo: enc.titulo, descripcion: enc.descripcion, slug: enc.slug,
      preguntas: enc.preguntas.map(p => ({
        id: p.id, texto: p.texto, tipo: p.tipo, obligatoria: p.obligatoria,
        opciones: p.opciones.map(o => ({ id: o.id, texto: o.texto })),
      })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al cargar encuesta' }); }
});

router.post('/public/:slug/responder', async (req, res) => {
  try {
    const [[row]] = await pool.execute(
      'SELECT id FROM crm_encuestas WHERE slug = ? AND activa = 1 LIMIT 1',
      [req.params.slug]
    );
    if (!row) return res.status(404).json({ error: 'Encuesta no encontrada o inactiva' });
    const enc = await loadSurveyFull(row.id);
    const enviadas = Array.isArray(req.body.respuestas) ? req.body.respuestas : [];
    const byPregunta = new Map(enviadas.map(r => [Number(r.pregunta_id), r]));

    for (const p of enc.preguntas) {
      const r = byPregunta.get(p.id);
      if (p.tipo === 'text') {
        if (p.obligatoria && !String(r?.texto || '').trim())
          return res.status(400).json({ error: `La pregunta "${p.texto}" es obligatoria` });
        continue;
      }
      const ids = r && Array.isArray(r.opcion_ids) ? r.opcion_ids.map(Number).filter(Boolean) : [];
      if (p.obligatoria && !ids.length)
        return res.status(400).json({ error: `La pregunta "${p.texto}" es obligatoria` });
      const validIds = new Set(p.opciones.map(o => o.id));
      for (const oid of ids)
        if (!validIds.has(oid)) return res.status(400).json({ error: 'Opción inválida' });
      if (p.tipo === 'single' && ids.length > 1)
        return res.status(400).json({ error: `Solo una opción permitida: "${p.texto}"` });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [insR] = await conn.execute('INSERT INTO crm_encuesta_respuestas (encuesta_id) VALUES (?)', [enc.id]);
      const respuestaId = insR.insertId;
      for (const p of enc.preguntas) {
        const r = byPregunta.get(p.id);
        if (p.tipo === 'text') {
          const texto = String(r?.texto || '').trim();
          if (texto) await conn.execute(
            'INSERT INTO crm_encuesta_respuesta_detalle (respuesta_id, pregunta_id, opcion_id, texto_respuesta) VALUES (?, ?, NULL, ?)',
            [respuestaId, p.id, texto]
          );
          continue;
        }
        const ids = r && Array.isArray(r.opcion_ids) ? r.opcion_ids.map(Number).filter(Boolean) : [];
        for (const oid of ids)
          await conn.execute(
            'INSERT INTO crm_encuesta_respuesta_detalle (respuesta_id, pregunta_id, opcion_id) VALUES (?, ?, ?)',
            [respuestaId, p.id, oid]
          );
      }
      await conn.commit();
      res.json({ message: '¡Gracias por tu respuesta!', ok: true });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al guardar respuesta' }); }
});

// ── Admin ──
router.get('/admin', requireSession, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT e.id, e.titulo, e.descripcion, e.slug, e.activa, e.created_at, e.updated_at,
        (SELECT COUNT(*) FROM crm_encuesta_respuestas r WHERE r.encuesta_id = e.id) AS total_respuestas,
        (SELECT COUNT(*) FROM crm_encuesta_preguntas p WHERE p.encuesta_id = e.id) AS total_preguntas
      FROM crm_encuestas e ORDER BY e.updated_at DESC, e.id DESC
    `);
    res.json(rows.map(r => ({ ...r, activa: !!r.activa })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al listar encuestas' }); }
});

router.get('/admin/:id', requireSession, async (req, res) => {
  try {
    const enc = await loadSurveyFull(Number(req.params.id));
    if (!enc) return res.status(404).json({ error: 'Encuesta no encontrada' });
    res.json(enc);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al cargar encuesta' }); }
});

router.get('/admin/:id/resultados', requireSession, async (req, res) => {
  try {
    const encuestaId = Number(req.params.id);
    const enc = await loadSurveyFull(encuestaId);
    if (!enc) return res.status(404).json({ error: 'Encuesta no encontrada' });
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM crm_encuesta_respuestas WHERE encuesta_id = ?', [encuestaId]
    );
    const preguntas = [];
    for (const p of enc.preguntas) {
      if (p.tipo === 'text') {
        const [textRows] = await pool.execute(
          `SELECT d.texto_respuesta, r.created_at FROM crm_encuesta_respuesta_detalle d
           INNER JOIN crm_encuesta_respuestas r ON r.id = d.respuesta_id
           WHERE r.encuesta_id = ? AND d.pregunta_id = ? AND d.texto_respuesta IS NOT NULL AND d.texto_respuesta <> ''
           ORDER BY r.created_at DESC`, [encuestaId, p.id]
        );
        preguntas.push({ id: p.id, texto: p.texto, tipo: p.tipo,
          respuestas_texto: textRows.map(r => ({ texto: r.texto_respuesta, fecha: r.created_at })) });
        continue;
      }
      const opciones = [];
      for (const o of p.opciones) {
        const [[{ cnt }]] = await pool.execute(
          `SELECT COUNT(*) AS cnt FROM crm_encuesta_respuesta_detalle d
           INNER JOIN crm_encuesta_respuestas r ON r.id = d.respuesta_id
           WHERE r.encuesta_id = ? AND d.pregunta_id = ? AND d.opcion_id = ?`,
          [encuestaId, p.id, o.id]
        );
        const percent = total > 0 ? Math.round((cnt / total) * 1000) / 10 : 0;
        opciones.push({ id: o.id, texto: o.texto, count: cnt, percent });
      }
      preguntas.push({ id: p.id, texto: p.texto, tipo: p.tipo, opciones });
    }
    res.json({ encuesta_id: encuestaId, titulo: enc.titulo, total_respuestas: total, preguntas });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al cargar resultados' }); }
});

router.post('/admin', requireSession, async (req, res) => {
  try {
    const titulo = String(req.body.titulo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    const descripcion = String(req.body.descripcion || '').trim() || null;
    const activa = req.body.activa !== false && req.body.activa !== 0 ? 1 : 0;
    const slug = await uniqueSlug();
    const preguntas = req.body.preguntas;
    if (!Array.isArray(preguntas) || !preguntas.length)
      return res.status(400).json({ error: 'Agrega al menos una pregunta' });
    const [ins] = await pool.execute(
      'INSERT INTO crm_encuestas (titulo, descripcion, slug, activa, creado_por) VALUES (?, ?, ?, ?, ?)',
      [titulo, descripcion, slug, activa, req.session.user.id]
    );
    await saveSurveyQuestions(ins.insertId, preguntas);
    res.status(201).json(await loadSurveyFull(ins.insertId));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al crear encuesta' }); }
});

router.put('/admin/:id', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[exists]] = await pool.execute('SELECT id, slug FROM crm_encuestas WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Encuesta no encontrada' });
    const titulo = String(req.body.titulo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    const descripcion = String(req.body.descripcion || '').trim() || null;
    const activa = req.body.activa !== false && req.body.activa !== 0 ? 1 : 0;
    const preguntas = req.body.preguntas;
    if (!Array.isArray(preguntas) || !preguntas.length)
      return res.status(400).json({ error: 'Agrega al menos una pregunta' });
    await pool.execute(
      'UPDATE crm_encuestas SET titulo = ?, descripcion = ?, activa = ? WHERE id = ?',
      [titulo, descripcion, activa, id]
    );
    await saveSurveyQuestions(id, preguntas);
    res.json(await loadSurveyFull(id));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar encuesta' }); }
});

router.delete('/admin/:id', requireSession, async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM crm_encuestas WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Encuesta no encontrada' });
    res.json({ message: 'Encuesta eliminada' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar encuesta' }); }
});

module.exports = router;
