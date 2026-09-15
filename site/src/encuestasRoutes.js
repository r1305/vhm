const { Router } = require('express');
const crypto = require('crypto');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureEncuestasSchema } = require('./encuestasSchema');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 10;

function randomSlug() {
  let result = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    result += SLUG_CHARS[crypto.randomInt(SLUG_CHARS.length)];
  }
  return result;
}

async function uniqueSlug() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const slug = randomSlug();
    const [rows] = await pool.execute('SELECT id FROM encuestas WHERE slug = ? LIMIT 1', [slug]);
    if (!rows.length) return slug;
  }
  return crypto.randomBytes(8).toString('hex').slice(0, SLUG_LENGTH);
}

async function loadSurveyFull(encuestaId) {
  const [encRows] = await pool.execute(
    'SELECT id, titulo, descripcion, slug, activa, created_at, updated_at FROM encuestas WHERE id = ?',
    [encuestaId]
  );
  if (!encRows.length) return null;
  const encuesta = encRows[0];
  encuesta.activa = !!encuesta.activa;

  const [preguntas] = await pool.execute(
    'SELECT id, texto, tipo, orden, obligatoria FROM encuesta_preguntas WHERE encuesta_id = ? ORDER BY orden ASC, id ASC',
    [encuestaId]
  );
  for (const p of preguntas) {
    p.obligatoria = !!p.obligatoria;
    const [opciones] = await pool.execute(
      'SELECT id, texto, orden FROM encuesta_opciones WHERE pregunta_id = ? ORDER BY orden ASC, id ASC',
      [p.id]
    );
    p.opciones = opciones;
  }
  encuesta.preguntas = preguntas;
  return encuesta;
}

async function saveSurveyQuestions(encuestaId, preguntas) {
  await pool.execute('DELETE FROM encuesta_preguntas WHERE encuesta_id = ?', [encuestaId]);
  if (!Array.isArray(preguntas) || !preguntas.length) return;

  for (let i = 0; i < preguntas.length; i++) {
    const p = preguntas[i];
    const texto = String(p.texto || '').trim();
    if (!texto) continue;
    const tipo = ['multiple', 'text'].includes(p.tipo) ? p.tipo : 'single';
    const obligatoria = p.obligatoria !== false && p.obligatoria !== 0 && p.obligatoria !== '0' ? 1 : 0;
    const [ins] = await pool.execute(
      'INSERT INTO encuesta_preguntas (encuesta_id, texto, tipo, orden, obligatoria) VALUES (?, ?, ?, ?, ?)',
      [encuestaId, texto, tipo, i, obligatoria]
    );
    const preguntaId = ins.insertId;
    if (tipo === 'text') continue;
    const opciones = Array.isArray(p.opciones) ? p.opciones : [];
    let ord = 0;
    for (const op of opciones) {
      const opText = typeof op === 'string' ? op.trim() : String(op.texto || '').trim();
      if (!opText) continue;
      await pool.execute(
        'INSERT INTO encuesta_opciones (pregunta_id, texto, orden) VALUES (?, ?, ?)',
        [preguntaId, opText, ord]
      );
      ord += 1;
    }
  }
}

// ——— Público ———
router.get('/public/:slug', async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const [rows] = await pool.execute(
      'SELECT id FROM encuestas WHERE slug = ? AND activa = 1 LIMIT 1',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Encuesta no encontrada o inactiva' });
    const encuesta = await loadSurveyFull(rows[0].id);
    if (!encuesta.preguntas.length) return res.status(404).json({ error: 'Encuesta sin preguntas' });
    res.json({
      id: encuesta.id,
      titulo: encuesta.titulo,
      descripcion: encuesta.descripcion,
      slug: encuesta.slug,
      preguntas: encuesta.preguntas.map((p) => ({
        id: p.id,
        texto: p.texto,
        tipo: p.tipo,
        obligatoria: p.obligatoria,
        opciones: p.opciones.map((o) => ({ id: o.id, texto: o.texto })),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar encuesta' });
  }
});

router.post('/public/:slug/responder', async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const [rows] = await pool.execute(
      'SELECT id FROM encuestas WHERE slug = ? AND activa = 1 LIMIT 1',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Encuesta no encontrada o inactiva' });
    const encuestaId = rows[0].id;
    const encuesta = await loadSurveyFull(encuestaId);
    const enviadas = Array.isArray(req.body.respuestas) ? req.body.respuestas : [];
    const byPregunta = new Map(enviadas.map((r) => [Number(r.pregunta_id), r]));

    for (const p of encuesta.preguntas) {
      const r = byPregunta.get(p.id);
      if (p.tipo === 'text') {
        const texto = String(r?.texto || '').trim();
        if (p.obligatoria && !texto) {
          return res.status(400).json({ error: `La pregunta "${p.texto}" es obligatoria` });
        }
        continue;
      }
      const ids = r && Array.isArray(r.opcion_ids) ? r.opcion_ids.map(Number).filter(Boolean) : [];
      if (p.obligatoria && !ids.length) {
        return res.status(400).json({ error: `La pregunta "${p.texto}" es obligatoria` });
      }
      const validIds = new Set(p.opciones.map((o) => o.id));
      for (const oid of ids) {
        if (!validIds.has(oid)) {
          return res.status(400).json({ error: 'Opción inválida en una respuesta' });
        }
      }
      if (p.tipo === 'single' && ids.length > 1) {
        return res.status(400).json({ error: `Solo una opción permitida: "${p.texto}"` });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [insR] = await conn.execute(
        'INSERT INTO encuesta_respuestas (encuesta_id) VALUES (?)',
        [encuestaId]
      );
      const respuestaId = insR.insertId;
      for (const p of encuesta.preguntas) {
        const r = byPregunta.get(p.id);
        if (p.tipo === 'text') {
          const texto = String(r?.texto || '').trim();
          if (texto) {
            await conn.execute(
              'INSERT INTO encuesta_respuesta_detalle (respuesta_id, pregunta_id, opcion_id, texto_respuesta) VALUES (?, ?, NULL, ?)',
              [respuestaId, p.id, texto]
            );
          }
          continue;
        }
        const ids = r && Array.isArray(r.opcion_ids) ? r.opcion_ids.map(Number).filter(Boolean) : [];
        for (const oid of ids) {
          await conn.execute(
            'INSERT INTO encuesta_respuesta_detalle (respuesta_id, pregunta_id, opcion_id) VALUES (?, ?, ?)',
            [respuestaId, p.id, oid]
          );
        }
      }
      await conn.commit();
      res.json({ message: '¡Gracias por tu respuesta!', ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar respuesta' });
  }
});

// ——— Admin ———
router.get('/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const [rows] = await pool.execute(`
      SELECT e.id, e.titulo, e.descripcion, e.slug, e.activa, e.created_at, e.updated_at,
        (SELECT COUNT(*) FROM encuesta_respuestas r WHERE r.encuesta_id = e.id) AS total_respuestas,
        (SELECT COUNT(*) FROM encuesta_preguntas p WHERE p.encuesta_id = e.id) AS total_preguntas
      FROM encuestas e
      ORDER BY e.updated_at DESC, e.id DESC
    `);
    res.json(rows.map((r) => ({ ...r, activa: !!r.activa })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar encuestas' });
  }
});

router.get('/admin/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const encuesta = await loadSurveyFull(Number(req.params.id));
    if (!encuesta) return res.status(404).json({ error: 'Encuesta no encontrada' });
    res.json(encuesta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar encuesta' });
  }
});

router.get('/admin/:id/resultados', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const encuestaId = Number(req.params.id);
    const encuesta = await loadSurveyFull(encuestaId);
    if (!encuesta) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM encuesta_respuestas WHERE encuesta_id = ?',
      [encuestaId]
    );
    const totalRespuestas = countRows[0]?.total || 0;

    const preguntas = [];
    for (const p of encuesta.preguntas) {
      if (p.tipo === 'text') {
        const [textRows] = await pool.execute(
          `SELECT d.texto_respuesta, r.created_at FROM encuesta_respuesta_detalle d
           INNER JOIN encuesta_respuestas r ON r.id = d.respuesta_id
           WHERE r.encuesta_id = ? AND d.pregunta_id = ? AND d.texto_respuesta IS NOT NULL AND d.texto_respuesta <> ''
           ORDER BY r.created_at DESC`,
          [encuestaId, p.id]
        );
        preguntas.push({
          id: p.id,
          texto: p.texto,
          tipo: p.tipo,
          respuestas_texto: textRows.map((row) => ({
            texto: row.texto_respuesta,
            fecha: row.created_at,
          })),
        });
        continue;
      }
      const opciones = [];
      for (const o of p.opciones) {
        const [cRows] = await pool.execute(
          `SELECT COUNT(*) AS cnt FROM encuesta_respuesta_detalle d
           INNER JOIN encuesta_respuestas r ON r.id = d.respuesta_id
           WHERE r.encuesta_id = ? AND d.pregunta_id = ? AND d.opcion_id = ?`,
          [encuestaId, p.id, o.id]
        );
        const count = cRows[0]?.cnt || 0;
        const percent = totalRespuestas > 0 ? Math.round((count / totalRespuestas) * 1000) / 10 : 0;
        opciones.push({ id: o.id, texto: o.texto, count, percent });
      }
      preguntas.push({
        id: p.id,
        texto: p.texto,
        tipo: p.tipo,
        opciones,
      });
    }

    res.json({
      encuesta_id: encuestaId,
      titulo: encuesta.titulo,
      total_respuestas: totalRespuestas,
      preguntas,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar resultados' });
  }
});

router.post('/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const titulo = String(req.body.titulo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    const descripcion = String(req.body.descripcion || '').trim() || null;
    const activa = req.body.activa !== false && req.body.activa !== 0 && req.body.activa !== '0' ? 1 : 0;
    const slug = await uniqueSlug();
    const preguntas = req.body.preguntas;
    if (!Array.isArray(preguntas) || !preguntas.length) {
      return res.status(400).json({ error: 'Agrega al menos una pregunta' });
    }

    const [ins] = await pool.execute(
      'INSERT INTO encuestas (titulo, descripcion, slug, activa, creado_por) VALUES (?, ?, ?, ?, ?)',
      [titulo, descripcion, slug, activa, req.user.id]
    );
    await saveSurveyQuestions(ins.insertId, preguntas);
    const encuesta = await loadSurveyFull(ins.insertId);
    res.status(201).json(encuesta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear encuesta' });
  }
});

router.put('/admin/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const id = Number(req.params.id);
    const [exists] = await pool.execute('SELECT id, slug FROM encuestas WHERE id = ?', [id]);
    if (!exists.length) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const titulo = String(req.body.titulo || '').trim();
    if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
    const descripcion = String(req.body.descripcion || '').trim() || null;
    const activa = req.body.activa !== false && req.body.activa !== 0 && req.body.activa !== '0' ? 1 : 0;
    const slug = exists[0].slug;

    const preguntas = req.body.preguntas;
    if (!Array.isArray(preguntas) || !preguntas.length) {
      return res.status(400).json({ error: 'Agrega al menos una pregunta' });
    }

    await pool.execute(
      'UPDATE encuestas SET titulo = ?, descripcion = ?, slug = ?, activa = ? WHERE id = ?',
      [titulo, descripcion, slug, activa, id]
    );
    await saveSurveyQuestions(id, preguntas);
    const encuesta = await loadSurveyFull(id);
    res.json(encuesta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar encuesta' });
  }
});

router.delete('/admin/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await ensureEncuestasSchema();
    const id = Number(req.params.id);
    const [r] = await pool.execute('DELETE FROM encuestas WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Encuesta no encontrada' });
    res.json({ message: 'Encuesta eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar encuesta' });
  }
});

module.exports = router;
