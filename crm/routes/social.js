const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const pool = require('../lib/db');
const { requireMenuPermisoApi } = require('../lib/menuPermisos');
const { isStaffAdmin } = require('../lib/roles');
const { fechaValida } = require('../lib/horaFecha');
const { enmascarar, esMascara } = require('../lib/configSecretos');
const social = require('../lib/social');

const router = Router();
const authSocial = requireMenuPermisoApi('social');
const authIntegraciones = requireMenuPermisoApi('integraciones');

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1000,
  standardHeaders: false,
  legacyHeaders: false,
});

function responderError(res, err, contexto) {
  if (err && err.publico) {
    return res.status(err.status || 400).json({ error: err.message, ...(err.codigo ? { codigo: err.codigo } : {}) });
  }
  console.error('[social/%s]:', contexto, err);
  res.status(500).json({ error: 'No se pudo completar la operación. Inténtalo nuevamente.' });
}

function idValido(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Webhook público (Meta) ───────────────────────────────────────
router.get('/webhook', (req, res) => {
  const cfg = social.configMeta();
  const ok = req.query['hub.mode'] === 'subscribe'
    && social.compararSeguro(String(req.query['hub.verify_token'] || ''), cfg.verifyToken);
  if (!ok) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

router.post('/webhook', webhookLimiter, async (req, res) => {
  const cfg = social.configMeta();
  if (!cfg.appSecret) {
    console.warn('[social/webhook] META_APP_SECRET no configurado: evento rechazado');
    return res.sendStatus(403);
  }
  if (!social.verificarFirma(req.rawBody, req.get('x-hub-signature-256'), cfg.appSecret)) {
    return res.sendStatus(403);
  }
  let nuevas;
  try {
    nuevas = await social.procesarEventos(social.normalizarEventos(req.body));
  } catch (err) {
    console.error('[social/webhook]:', err.code || err.message);
    return res.sendStatus(500);
  }
  res.sendStatus(200);
  if (nuevas.length) social.completarPerfiles(nuevas).catch(() => {});
});

// ── Estado / configuración de cuenta ─────────────────────────────
router.get('/status', authSocial, async (req, res) => {
  try {
    const cfg = social.configMeta();
    const [[cuenta]] = await pool.execute(
      "SELECT access_token FROM social_cuentas WHERE canal = 'instagram' AND activo = 1 ORDER BY id LIMIT 1"
    );
    res.json({
      cuenta_configurada: !!cuenta,
      token_configurado: !!(cuenta && cuenta.access_token),
      webhook_configurado: !!(cfg.appSecret && cfg.verifyToken),
    });
  } catch (err) { responderError(res, err, 'status'); }
});

router.get('/cuenta', authIntegraciones, async (req, res) => {
  try {
    if (!isStaffAdmin(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
    const [[c]] = await pool.execute(
      "SELECT external_id, nombre, access_token FROM social_cuentas WHERE canal = 'instagram' ORDER BY id LIMIT 1"
    );
    if (!c) return res.json({ configurada: false });
    res.json({
      configurada: true,
      external_id: c.external_id,
      nombre: c.nombre || '',
      access_token: enmascarar(c.access_token, 'access_token'),
      access_token_configurado: !!c.access_token,
    });
  } catch (err) { responderError(res, err, 'cuenta/leer'); }
});

router.put('/cuenta', authIntegraciones, async (req, res) => {
  try {
    if (!isStaffAdmin(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
    const externalId = String(req.body?.external_id || '').trim();
    if (!/^\d{5,30}$/.test(externalId)) return res.status(400).json({ error: 'El ID de la cuenta de Instagram debe ser numérico' });
    const nombre = String(req.body?.nombre || '').trim().slice(0, 120) || null;
    const token = req.body?.access_token == null ? '' : String(req.body.access_token).trim();
    const nuevoToken = token && !esMascara(token) ? token : null;

    const [[actual]] = await pool.execute(
      "SELECT id FROM social_cuentas WHERE canal = 'instagram' ORDER BY id LIMIT 1"
    );
    if (actual) {
      await pool.execute(
        'UPDATE social_cuentas SET external_id = ?, nombre = ?, access_token = COALESCE(?, access_token), activo = 1 WHERE id = ?',
        [externalId, nombre, nuevoToken, actual.id]
      );
    } else {
      await pool.execute(
        "INSERT INTO social_cuentas (canal, external_id, nombre, access_token) VALUES ('instagram', ?, ?, ?)",
        [externalId, nombre, nuevoToken]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Esa cuenta ya está registrada' });
    responderError(res, err, 'cuenta/guardar');
  }
});

// ── Bandeja ──────────────────────────────────────────────────────
router.get('/conversaciones', authSocial, async (req, res) => {
  try {
    const f = social.filtroVisibilidad(req.user, 'c');
    const params = [...f.params];
    let sql = `
      SELECT c.id, c.canal, c.external_id, c.nombre, c.username, c.asignado_a, c.estado,
             c.ultimo_mensaje, c.ultimo_mensaje_at, c.ultimo_entrante_at, c.no_leidos,
             t.nombre AS asignado_nombre, t.apellido AS asignado_apellido
      FROM social_conversaciones c
      LEFT JOIN terapeutas t ON t.id = c.asignado_a
      WHERE 1=1${f.sql}`;
    if (['abierta', 'cerrada'].includes(req.query.estado)) { sql += ' AND c.estado = ?'; params.push(req.query.estado); }
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q) {
      sql += ' AND (c.nombre LIKE ? OR c.username LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY c.ultimo_mensaje_at DESC, c.id DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    res.json(rows.map(r => ({
      ...r,
      ventana_abierta: social.ventanaAbierta(r.ultimo_entrante_at),
    })));
  } catch (err) { responderError(res, err, 'conversaciones/listar'); }
});

router.get('/conversaciones/:id/mensajes', authSocial, async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Conversación inválida' });
    const conv = await social.cargarConversacionVisible(id, req.user);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    const [rows] = await pool.execute(
      `SELECT * FROM (
         SELECT m.id, m.direccion, m.tipo, m.cuerpo, m.recibido_at, m.respondido_at,
                m.enviado_por, t.nombre AS enviado_nombre, t.apellido AS enviado_apellido
         FROM social_mensajes m
         LEFT JOIN terapeutas t ON t.id = m.enviado_por
         WHERE m.conversacion_id = ?
         ORDER BY m.recibido_at DESC, m.id DESC
         LIMIT 300
       ) x ORDER BY recibido_at ASC, id ASC`,
      [id]
    );
    res.json({
      conversacionId: id,
      ventana_abierta: social.ventanaAbierta(conv.ultimo_entrante_at),
      ventana_expira_at: social.ventanaExpiraAt(conv.ultimo_entrante_at),
      mensajes: rows,
    });
  } catch (err) { responderError(res, err, 'conversaciones/mensajes'); }
});

router.patch('/conversaciones/:id/leer', authSocial, async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Conversación inválida' });
    const conv = await social.cargarConversacionVisible(id, req.user);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
    await pool.execute('UPDATE social_conversaciones SET no_leidos = 0 WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) { responderError(res, err, 'conversaciones/leer'); }
});

router.post('/conversaciones/:id/mensajes', authSocial, async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Conversación inválida' });
    const r = await social.enviarRespuesta({ conversacionId: id, user: req.user, texto: req.body?.mensaje });
    res.status(201).json({ ok: true, id: r.id });
  } catch (err) { responderError(res, err, 'conversaciones/enviar'); }
});

router.patch('/conversaciones/:id/asignar', authSocial, async (req, res) => {
  try {
    if (!isStaffAdmin(req.user.rol)) return res.status(403).json({ error: 'Solo el personal administrativo puede asignar conversaciones' });
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Conversación inválida' });
    let terapeutaId = null;
    if (req.body?.terapeuta_id != null && req.body.terapeuta_id !== '') {
      terapeutaId = idValido(req.body.terapeuta_id);
      if (!terapeutaId) return res.status(400).json({ error: 'Terapeuta inválido' });
      const [[t]] = await pool.execute("SELECT id FROM terapeutas WHERE id = ? AND rol = 'terapeuta' AND activo = 1", [terapeutaId]);
      if (!t) return res.status(404).json({ error: 'Terapeuta no encontrado' });
    }
    const [r] = await pool.execute('UPDATE social_conversaciones SET asignado_a = ? WHERE id = ?', [terapeutaId, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ ok: true });
  } catch (err) { responderError(res, err, 'conversaciones/asignar'); }
});

router.get('/terapeutas', authSocial, async (req, res) => {
  try {
    if (!isStaffAdmin(req.user.rol)) return res.json([]);
    const [rows] = await pool.execute(
      "SELECT id, nombre, apellido FROM terapeutas WHERE rol = 'terapeuta' AND activo = 1 ORDER BY nombre, apellido"
    );
    res.json(rows);
  } catch (err) { responderError(res, err, 'terapeutas'); }
});

// ── Métricas base: consultas por hora y por terapeuta ───────────
// "Consulta" = primer mensaje entrante de cada ráfaga (los que esperan una misma respuesta).
function fechaLima(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

router.get('/metricas', authSocial, async (req, res) => {
  try {
    const hasta = req.query.hasta ? String(req.query.hasta) : fechaLima(new Date());
    const desde = req.query.desde
      ? String(req.query.desde)
      : fechaLima(new Date(new Date(`${hasta}T12:00:00-05:00`).getTime() - 29 * 86400000));
    if (!fechaValida(desde) || !fechaValida(hasta)) return res.status(400).json({ error: 'Fechas inválidas (YYYY-MM-DD)' });
    const dias = (new Date(`${hasta}T00:00:00-05:00`) - new Date(`${desde}T00:00:00-05:00`)) / 86400000;
    if (dias < 0) return res.status(400).json({ error: 'La fecha inicial es posterior a la final' });
    if (dias > 366) return res.status(400).json({ error: 'El rango máximo es de 366 días' });

    const f = social.filtroVisibilidad(req.user, 'c');
    const base = (join = '') => `
      FROM social_mensajes m
      JOIN social_conversaciones c ON c.id = m.conversacion_id${join}
      WHERE m.direccion = 'incoming'
        AND m.recibido_at >= ? AND m.recibido_at < DATE_ADD(?, INTERVAL 1 DAY)${f.sql}
        AND NOT EXISTS (
          SELECT 1 FROM social_mensajes p
          WHERE p.conversacion_id = m.conversacion_id AND p.direccion = 'incoming'
            AND p.id < m.id AND p.respondido_at <=> m.respondido_at
        )`;
    const params = [desde, hasta, ...f.params];

    const [porHora] = await pool.execute(
      `SELECT HOUR(m.recibido_at) AS hora, COUNT(*) AS consultas,
              SUM(m.respondido_at IS NOT NULL) AS respondidas,
              ROUND(AVG(TIMESTAMPDIFF(SECOND, m.recibido_at, m.respondido_at))) AS seg_primera_respuesta
       ${base()}
       GROUP BY HOUR(m.recibido_at) ORDER BY hora`,
      params
    );
    const [porTerapeuta] = await pool.execute(
      `SELECT m.respondido_por AS terapeuta_id, t.nombre, t.apellido, COUNT(*) AS respondidas,
              ROUND(AVG(TIMESTAMPDIFF(SECOND, m.recibido_at, m.respondido_at))) AS seg_primera_respuesta
       ${base(' LEFT JOIN terapeutas t ON t.id = m.respondido_por')} AND m.respondido_at IS NOT NULL
       GROUP BY m.respondido_por, t.nombre, t.apellido
       ORDER BY respondidas DESC`,
      params
    );
    const [[sin]] = await pool.execute(
      `SELECT COUNT(*) AS n ${base()} AND m.respondido_at IS NULL`,
      params
    );
    res.json({ desde, hasta, zona: 'America/Lima', por_hora: porHora, por_terapeuta: porTerapeuta, sin_responder: sin.n });
  } catch (err) { responderError(res, err, 'metricas'); }
});

module.exports = router;
