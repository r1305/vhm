const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { ensureSchema } = require('./schema');
const { listSlugs, getDefault, getMeta } = require('../lib/tribuContenidoDefaults');

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido' });
}

router.use(async (req, res, next) => {
  try { await ensureSchema(); next(); }
  catch { res.status(503).json({ error: 'El servicio se está inicializando.' }); }
});

async function readDatos(slug) {
  const [rows] = await pool.execute(
    'SELECT datos FROM tribu_contenido_paginas WHERE slug = ? LIMIT 1',
    [slug]
  );
  if (!rows.length) return getDefault(slug);
  const raw = rows[0].datos;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return parsed;
}

function isKnownSlug(slug) {
  return listSlugs().includes(slug);
}

// Admin — catálogo
router.get('/admin/catalogo', authMiddleware, requireAdmin, (req, res) => {
  res.json({
    slugs: listSlugs().map(slug => ({ slug, ...getMeta(slug) })),
  });
});

// Admin — leer
router.get('/admin/:slug', authMiddleware, requireAdmin, async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!isKnownSlug(slug)) return res.status(404).json({ error: 'Sección no encontrada' });
  try {
    const datos = await readDatos(slug);
    res.json({ slug, datos, default: getDefault(slug), meta: getMeta(slug) });
  } catch {
    res.status(500).json({ error: 'Error al leer contenido' });
  }
});

// Admin — guardar
router.put('/admin/:slug', authMiddleware, requireAdmin, async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!isKnownSlug(slug)) return res.status(404).json({ error: 'Sección no encontrada' });
  const datos = req.body?.datos;
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return res.status(400).json({ error: 'Se requiere un objeto JSON en "datos"' });
  }
  try {
    const json = JSON.stringify(datos);
    await pool.execute(
      `INSERT INTO tribu_contenido_paginas (slug, datos) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE datos = VALUES(datos)`,
      [slug, json]
    );
    res.json({ ok: true, slug });
  } catch {
    res.status(500).json({ error: 'Error al guardar contenido' });
  }
});

// Admin — restaurar default
router.post('/admin/:slug/restaurar', authMiddleware, requireAdmin, async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!isKnownSlug(slug)) return res.status(404).json({ error: 'Sección no encontrada' });
  const def = getDefault(slug);
  if (!def) return res.status(404).json({ error: 'Sin default' });
  try {
    await pool.execute(
      `INSERT INTO tribu_contenido_paginas (slug, datos) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE datos = VALUES(datos)`,
      [slug, JSON.stringify(def)]
    );
    res.json({ ok: true, datos: def });
  } catch {
    res.status(500).json({ error: 'Error al restaurar' });
  }
});

// Público (después de rutas /admin/*)
router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!isKnownSlug(slug)) return res.status(404).json({ error: 'Sección no encontrada' });
  try {
    const datos = await readDatos(slug);
    if (!datos) return res.status(404).json({ error: 'Sin contenido' });
    res.json(datos);
  } catch {
    res.status(500).json({ error: 'Error al leer contenido' });
  }
});

module.exports = router;
