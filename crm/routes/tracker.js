/**
 * Tracker web — endpoints públicos (sin auth)
 * POST /api/track/sesion    — inicia o actualiza sesión
 * POST /api/track/evento    — registra un evento
 * GET  /api/track/stats     — estadísticas para el panel (requiere auth)
 */
const { Router } = require('express');
const crypto = require('crypto');
const pool = require('../lib/db');
const { auth } = require('../lib/auth');

const router = Router();

function s(v, max = 500) {
  if (v == null) return null;
  return String(v).trim().slice(0, max) || null;
}

function detectDevice(ua) {
  if (!ua) return 'desktop';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectBrowser(ua) {
  if (!ua) return 'Otro';
  if (/edg/i.test(ua))                              return 'Edge';
  if (/chrome|crios/i.test(ua))                     return 'Chrome';
  if (/firefox|fxios/i.test(ua))                    return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua))    return 'Safari';
  if (/opera|opr/i.test(ua))                        return 'Opera';
  return 'Otro';
}

// Generar ID de sesión único
function newSesionId() {
  return crypto.randomUUID ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

// ── Iniciar / actualizar sesión ───────────────────────────────
router.post('/sesion', async (req, res) => {
  try {
    const {
      sesion_id, visitor_id, pagina, referrer,
      utm_source, utm_medium, utm_campaign, utm_content,
      duracion_seg, scroll_max, lead_id,
    } = req.body || {};

    const ua  = req.headers['user-agent'] || '';
    const sid = s(sesion_id, 36) || newSesionId();
    const vid = s(visitor_id, 64) || crypto.createHash('sha256')
      .update((req.ip || '') + ua).digest('hex').slice(0, 64);

    const dispositivo = detectDevice(ua);
    const navegador   = detectBrowser(ua);

    // Upsert — si ya existe la sesión, actualiza duración/scroll/lead
    await pool.execute(`
      INSERT INTO web_sesiones
        (id, visitor_id, pagina, referrer, utm_source, utm_medium,
         utm_campaign, utm_content, dispositivo, navegador,
         duracion_seg, scroll_max, lead_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        duracion_seg = COALESCE(VALUES(duracion_seg), duracion_seg),
        scroll_max   = GREATEST(scroll_max, COALESCE(VALUES(scroll_max), 0)),
        lead_id      = COALESCE(VALUES(lead_id), lead_id)
    `, [
      sid, vid,
      s(pagina), s(referrer),
      s(utm_source, 200), s(utm_medium, 200),
      s(utm_campaign, 200), s(utm_content, 200),
      dispositivo, navegador,
      duracion_seg || null,
      scroll_max   || 0,
      lead_id      || null,
    ]);

    res.json({ ok: true, sesion_id: sid, visitor_id: vid });
  } catch (err) {
    console.error('[tracker/sesion]', err.message);
    res.status(500).json({ error: 'Error de tracking' });
  }
});

// ── Registrar evento ─────────────────────────────────────────
router.post('/evento', async (req, res) => {
  try {
    const { sesion_id, visitor_id, tipo, elemento, pagina, valor } = req.body || {};
    if (!sesion_id || !tipo) return res.sendStatus(204);

    const TIPOS_VALIDOS = ['pageview','click','scroll','form_start','form_submit','conversion','custom'];
    if (!TIPOS_VALIDOS.includes(tipo)) return res.sendStatus(204);

    const vid = s(visitor_id, 64) || 'unknown';

    await pool.execute(`
      INSERT INTO web_eventos (sesion_id, visitor_id, tipo, elemento, pagina, valor)
      VALUES (?,?,?,?,?,?)
    `, [s(sesion_id, 36), vid, tipo, s(elemento, 300), s(pagina), s(valor)]);

    res.sendStatus(204);
  } catch (err) {
    console.error('[tracker/evento]', err.message);
    res.sendStatus(204); // no mostrar errores al visitante
  }
});

// ── Estadísticas (requiere auth) ──────────────────────────────
router.get('/stats', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde) ? req.query.desde : today;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta) ? req.query.hasta : today;

    // KPIs generales
    const [[kpis]] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM web_sesiones
          WHERE DATE(created_at) BETWEEN ? AND ?) AS total_sesiones,
        (SELECT COUNT(DISTINCT visitor_id) FROM web_sesiones
          WHERE DATE(created_at) BETWEEN ? AND ?) AS visitantes_unicos,
        (SELECT ROUND(AVG(duracion_seg)) FROM web_sesiones
          WHERE DATE(created_at) BETWEEN ? AND ? AND duracion_seg IS NOT NULL AND duracion_seg > 0) AS duracion_promedio,
        (SELECT ROUND(AVG(scroll_max)) FROM web_sesiones
          WHERE DATE(created_at) BETWEEN ? AND ? AND scroll_max > 0) AS scroll_promedio,
        (SELECT COUNT(*) FROM web_sesiones
          WHERE DATE(created_at) BETWEEN ? AND ? AND lead_id IS NOT NULL) AS sesiones_convertidas,
        (SELECT COUNT(*) FROM web_eventos
          WHERE tipo='conversion' AND DATE(created_at) BETWEEN ? AND ?) AS conversiones,
        (SELECT COUNT(*) FROM web_sesiones
          WHERE DATE(created_at) BETWEEN ? AND ? AND duracion_seg <= 10) AS rebotes
    `, [
      desde, hasta, desde, hasta, desde, hasta,
      desde, hasta, desde, hasta, desde, hasta, desde, hasta,
    ]);

    // Tasa de rebote y conversión
    kpis.tasa_rebote = kpis.total_sesiones > 0
      ? Math.round((kpis.rebotes / kpis.total_sesiones) * 100) : 0;
    kpis.tasa_conversion = kpis.total_sesiones > 0
      ? Math.round((kpis.sesiones_convertidas / kpis.total_sesiones) * 100) : 0;

    // Sesiones por día
    const [sesionesPorDia] = await pool.execute(`
      SELECT DATE(created_at) AS dia, COUNT(*) AS sesiones,
             COUNT(DISTINCT visitor_id) AS unicos
      FROM web_sesiones WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at) ORDER BY dia ASC
    `, [desde, hasta]);

    // Top páginas
    const [topPaginas] = await pool.execute(`
      SELECT pagina,
             COUNT(*) AS visitas,
             COUNT(DISTINCT visitor_id) AS unicos,
             ROUND(AVG(duracion_seg)) AS duracion_prom,
             ROUND(AVG(scroll_max)) AS scroll_prom
      FROM web_sesiones WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY pagina ORDER BY visitas DESC LIMIT 10
    `, [desde, hasta]);

    // Por dispositivo
    const [porDispositivo] = await pool.execute(`
      SELECT dispositivo, COUNT(*) AS total
      FROM web_sesiones WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY dispositivo ORDER BY total DESC
    `, [desde, hasta]);

    // Por navegador
    const [porNavegador] = await pool.execute(`
      SELECT navegador, COUNT(*) AS total
      FROM web_sesiones WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY navegador ORDER BY total DESC
    `, [desde, hasta]);

    // Por fuente de tráfico
    const [porFuente] = await pool.execute(`
      SELECT
        COALESCE(NULLIF(utm_source,''), 
          CASE WHEN referrer LIKE '%google%' THEN 'google'
               WHEN referrer LIKE '%instagram%' OR referrer LIKE '%facebook%' THEN 'instagram/facebook'
               WHEN referrer LIKE '%tiktok%' THEN 'tiktok'
               WHEN referrer IS NULL OR referrer='' THEN 'directo'
               ELSE 'referido'
          END
        ) AS fuente,
        COUNT(*) AS sesiones,
        COUNT(DISTINCT visitor_id) AS unicos
      FROM web_sesiones WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY fuente ORDER BY sesiones DESC LIMIT 10
    `, [desde, hasta]);

    // Top clicks
    const [topClicks] = await pool.execute(`
      SELECT elemento, COUNT(*) AS clicks
      FROM web_eventos WHERE tipo='click' AND DATE(created_at) BETWEEN ? AND ?
        AND elemento IS NOT NULL
      GROUP BY elemento ORDER BY clicks DESC LIMIT 10
    `, [desde, hasta]);

    // Eventos recientes
    const [eventosRecientes] = await pool.execute(`
      SELECT e.tipo, e.elemento, e.pagina, e.created_at,
             s.dispositivo, s.navegador, s.utm_source
      FROM web_eventos e
      LEFT JOIN web_sesiones s ON e.sesion_id = s.id
      WHERE DATE(e.created_at) BETWEEN ? AND ?
        AND e.tipo IN ('conversion','form_submit','click')
      ORDER BY e.created_at DESC LIMIT 20
    `, [desde, hasta]);

    res.json({
      desde, hasta, kpis,
      sesionesPorDia, topPaginas,
      porDispositivo, porNavegador, porFuente,
      topClicks, eventosRecientes,
    });
  } catch (err) {
    console.error('[tracker/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
