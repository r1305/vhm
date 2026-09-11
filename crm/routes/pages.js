const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');
const { getHomePath } = require('../lib/crmNav');
const { isStaffAdmin, isSuperAdmin } = require('../lib/roles');

const TITLES = {
  dashboard:       'Dashboard',
  agenda:          'Agenda',
  pacientes:       'Pacientes',
  leads:           'Leads',
  historial:       'Historial clínico',
  consentimientos: 'Consentimientos',
  espera:          'Lista de espera',
  terapeutas:      'Usuarios',
  reportes:        'Reportes',
  analitica:       'Analítica web',
  marketing:       'Email Marketing',
  integraciones:   'Integraciones',
  whatsapp:        'Central WhatsApp',
  asignacion:      'Asignación automática',
  calendario:      'Calendario',
  disponibilidad:  'Mi disponibilidad',
  permisos_menu:   'Permisos de menú',
};

const ESTADO_CITA_CSS = {
  pendiente:  'badge-yellow',
  confirmada: 'badge-blue',
  reagendada: 'badge-purple',
  realizada:  'badge-green',
  cancelada:  'badge-red',
  no_show:    'badge-gray',
};

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Middleware: requiere sesión ──────────────────────────────────
function requireSession(req, res, next) {
  if (req.session?.user) return next();
  res.redirect(`${req.app.locals.BASE}/login`);
}

// ── Middleware: solo admin ───────────────────────────────────────
function requireAdmin(req, res, next) {
  if (isStaffAdmin(req.session?.user?.rol)) return next();
  res.redirect(`${req.app.locals.BASE}/${getHomePath(req.session?.user)}`);
}

function requireSuperAdmin(req, res, next) {
  if (isSuperAdmin(req.session?.user?.rol)) return next();
  res.redirect(`${req.app.locals.BASE}/${getHomePath(req.session?.user)}`);
}

// ── Helper render con layout ─────────────────────────────────────
async function render(res, view, data = {}) {
  const BASE    = res.app.locals.BASE;
  const user    = data.user;
  const isAdmin = isStaffAdmin(user?.rol);
  const { getMenuPermisosForUser } = require('../lib/menuPermisos');
  const menuPermisos = await getMenuPermisosForUser(user.id, user?.rol || 'terapeuta');
  const scripts = data.scripts
    ? data.scripts.replace(/(\.js)(["'])/g, `$1?v=${res.app.locals.assetVersion}$2`)
    : '';
  const locals  = {
    ...data,
    BASE, title: TITLES[view] || view, view, user, isAdmin, menuPermisos,
    scripts, assetVersion: res.app.locals.assetVersion, partialView: view,
  };
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.render('layout', locals);
}

// ── SERVICE WORKER (con version inyectada) ──────────────────────
router.get('/sw.js', (req, res) => {
  const fs = require('fs');
  const swPath = require('path').join(__dirname, '../public/sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace('__ASSET_VERSION__', res.app.locals.assetVersion);
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(sw);
});

// ── PWA INSTALL TRACKING ──────────────────────────────────
router.post('/api/pwa/install', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false });
  try {
    await db.execute(
      'INSERT INTO pwa_installs (user_id, user_agent) VALUES (?, ?)',
      [req.session.user.id, (req.headers['user-agent'] || '').slice(0, 500)]
    );
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

// ── AGENDAR (público, sin auth) ────────────────────────────────
router.get('/agendar/:username', async (req, res) => {
  try {
    const [[terapeuta]] = await db.execute(
      'SELECT id, nombre, apellido, username, especialidad FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!terapeuta) return res.status(404).send('Terapeuta no encontrado');
    res.render('agendar', { BASE: req.app.locals.BASE, terapeuta });
  } catch (err) { res.status(500).send(err.message); }
});

// ── LOGIN ────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect(`${req.app.locals.BASE}/${getHomePath(req.session.user)}`);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.render('login', { BASE: req.app.locals.BASE, error: null, assetVersion: req.app.locals.assetVersion });
});

router.post('/login', async (req, res) => {
  const BASE = req.app.locals.BASE;
  const { username, password } = req.body;
  try {
    const bcrypt = require('bcryptjs');
    const [[user]] = await db.execute(
      'SELECT id, nombre, apellido, username, rol, activo, password FROM terapeutas WHERE username = ?',
      [username]
    );
    if (!user || !user.activo) throw new Error('Usuario no encontrado');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new Error('Contraseña incorrecta');
    req.session.user = { id: user.id, nombre: user.nombre, apellido: user.apellido, username: user.username, rol: user.rol };
    res.redirect(`${BASE}/${getHomePath(req.session.user)}`);
  } catch (err) {
    res.render('login', { BASE, error: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect(`${req.app.locals.BASE}/login`));
});

// ── MI REPORTE (terapeutas) ──────────────────────────────────────
router.get('/mi-reporte', requireSession, (req, res) => {
  render(res, 'mi_reporte', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/mi_reporte.js"></script>` });
});

// ── DASHBOARD ────────────────────────────────────────────────────
router.get('/dashboard', requireSession, (req, res, next) => {
  if (req.session.user.rol === 'terapeuta') {
    return res.redirect(`${req.app.locals.BASE}/agenda`);
  }
  next();
}, requireAdmin, async (req, res) => {
  const user = req.session.user;
  try {
    const [[{ pacientes_activos }]] = await db.execute("SELECT COUNT(*) AS pacientes_activos FROM pacientes WHERE estado = 'activo'");
    const [[{ retenidos }]]         = await db.execute('SELECT COUNT(*) AS retenidos FROM (SELECT paciente_id FROM paciente_sesiones GROUP BY paciente_id HAVING COUNT(*) >= 2) x');
    const [[{ altas_mes }]]         = await db.execute("SELECT COUNT(*) AS altas_mes FROM pacientes WHERE estado='alta' AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')");
    const [[{ sin_paquete }]]       = await db.execute("SELECT COUNT(*) AS sin_paquete FROM pacientes p WHERE p.estado='activo' AND NOT EXISTS (SELECT 1 FROM paciente_sesiones ps WHERE ps.paciente_id = p.id)");
    const [[{ leads_mes }]]         = await db.execute("SELECT COUNT(*) AS leads_mes FROM leads WHERE DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')");
    const [[{ convertidos_mes }]]   = await db.execute("SELECT COUNT(*) AS convertidos_mes FROM leads WHERE estado='convertido' AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')");
    const [[{ no_show_mes }]]       = await db.execute("SELECT COUNT(*) AS no_show_mes FROM citas WHERE estado='no_show' AND DATE_FORMAT(fecha,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')");
    const [[{ citas_mes }]]         = await db.execute("SELECT COUNT(*) AS citas_mes FROM citas WHERE estado IN ('realizada','no_show') AND DATE_FORMAT(fecha,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')");
    const [[{ lista_espera }]]      = await db.execute('SELECT COUNT(*) AS lista_espera FROM lista_espera WHERE activo=1');

    const tasaRetencion   = pacientes_activos > 0 ? Math.round((retenidos / pacientes_activos) * 100) : 0;
    const tasaConversion  = leads_mes > 0 ? Math.round((convertidos_mes / leads_mes) * 100) : 0;
    const tasaNoShow      = citas_mes > 0 ? Math.round((no_show_mes / citas_mes) * 100) : 0;
    // Próximos a agotar sesiones (≤2 restantes)
    const [proximosAgotar] = await db.execute(`
      SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
             COALESCE((SELECT SUM(ps.sesiones) FROM paciente_sesiones ps WHERE ps.paciente_id = p.id), 0) AS sesiones_total,
             COALESCE((SELECT COUNT(*) FROM citas c WHERE c.paciente_id = p.id AND c.estado IN ('realizada','no_show')), 0) AS sesiones_usadas
      FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id
      WHERE p.estado = 'activo'
      HAVING sesiones_total > 0 AND (sesiones_total - sesiones_usadas) <= 2
      ORDER BY (sesiones_total - sesiones_usadas) ASC, p.nombre ASC
      LIMIT 15
    `);

    // En riesgo de abandono: activos sin cita realizada en 30+ días
    const [enRiesgo] = await db.execute(`
      SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
             MAX(c.fecha) AS ultima_cita
      FROM pacientes p
      LEFT JOIN terapeutas t ON p.terapeuta_id = t.id
      LEFT JOIN citas c ON c.paciente_id = p.id AND c.estado = 'realizada'
      WHERE p.estado = 'activo'
      GROUP BY p.id
      HAVING ultima_cita IS NULL OR ultima_cita < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      ORDER BY ultima_cita ASC
      LIMIT 15
    `);

    // Activos sin paquete asignado

    const [sinPaquete] = await db.execute(`
      SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
             p.created_at
      FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id
      WHERE p.estado = 'activo'
        AND NOT EXISTS (SELECT 1 FROM paciente_sesiones ps WHERE ps.paciente_id = p.id)
      ORDER BY p.created_at DESC LIMIT 10
    `);

    // Paquetes vencidos con sesiones sin usar
    const [packVencidos] = await db.execute(`
      SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
             pk.nombre AS pack_nombre, pk.vence_at,
             (pk.sesiones_total - pk.sesiones_usadas) AS sesiones_restantes
      FROM packs pk
      JOIN pacientes p ON p.id = pk.paciente_id
      LEFT JOIN terapeutas t ON t.id = p.terapeuta_id
      WHERE pk.vence_at < CURDATE()
        AND pk.activo = 1
        AND (pk.sesiones_total - pk.sesiones_usadas) > 0
      ORDER BY pk.vence_at ASC LIMIT 10
    `);

    // Ocupación por terapeuta
    const [ocupacion] = await db.execute(`
      SELECT t.id, t.nombre, t.apellido,
             COUNT(p.id) AS pacientes_asignados
      FROM terapeutas t
      LEFT JOIN pacientes p ON p.terapeuta_id = t.id AND p.estado = 'activo'
      WHERE t.activo = 1
      GROUP BY t.id ORDER BY pacientes_asignados DESC
    `);

    const kpis = [
      { label: 'Pacientes activos',   value: pacientes_activos, sub: null, state: null },
      { label: 'Tasa de retención',   value: `${tasaRetencion}%`, sub: `${retenidos} con 2+ paquetes`, state: tasaRetencion >= 50 ? 'ok' : 'warn' },
      { label: 'Conversión leads',    value: `${tasaConversion}%`, sub: `${convertidos_mes} de ${leads_mes} este mes`, state: tasaConversion >= 30 ? 'ok' : 'warn' },
      { label: 'No-show del mes',     value: `${tasaNoShow}%`, sub: `${no_show_mes} de ${citas_mes} citas`, state: tasaNoShow > 15 ? 'warn' : 'ok' },
      { label: 'Altas este mes',      value: altas_mes, sub: 'tratamientos finalizados', state: null },
      { label: 'Sin paquete activo',  value: sin_paquete, sub: 'pacientes activos', state: sin_paquete > 0 ? 'warn' : null },
    ];

    render(res, 'dashboard', {
      user, kpis,
      proximosAgotar, enRiesgo,
      sinPaquete, packVencidos, ocupacion,
      lista_espera,
      scripts: `<script src="${req.app.locals.BASE}/dashboard.js"></script>`
    });
  } catch (err) { res.status(500).send(err.message); }
});

// ── CALENDARIO ─────────────────────────────────────────────────
router.get('/calendario', requireSession, async (req, res) => {
  const user = req.session.user;
  try {
    const [terapeutas] = await db.execute('SELECT id, nombre, apellido FROM terapeutas WHERE activo=1 ORDER BY nombre');
    render(res, 'calendario', { user, terapeutas, scripts: `<script src="${req.app.locals.BASE}/citas_modal.js"></script><script src="${req.app.locals.BASE}/calendario.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── AGENDA ───────────────────────────────────────────────────────
router.get('/agenda', requireSession, async (req, res) => {
  const user = req.session.user;
  try {
    const [terapeutas] = await db.execute('SELECT id, nombre, apellido FROM terapeutas WHERE activo=1 ORDER BY nombre');
    const qs = user.rol === 'terapeuta' ? 'WHERE terapeuta_id = ?' : 'WHERE 1';
    const params = user.rol === 'terapeuta' ? [user.id] : [];
    const [pacientes] = await db.execute(`SELECT id, nombre, apellido FROM pacientes ${qs} ORDER BY nombre`, params);
    render(res, 'agenda', { user, terapeutas, pacientes, scripts: `<script src="${req.app.locals.BASE}/citas_modal.js"></script><script src="${req.app.locals.BASE}/agenda.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── PACIENTES ────────────────────────────────────────────────────
router.get('/pacientes', requireSession, async (req, res) => {
  const user = req.session.user;
  try {
    const [terapeutas] = await db.execute('SELECT id, nombre, apellido FROM terapeutas WHERE activo=1 ORDER BY nombre');
    const [rows]       = await db.execute('SELECT terapeuta_id, COUNT(*) AS total FROM pacientes GROUP BY terapeuta_id');
    const conteo       = Object.fromEntries(rows.map(r => [r.terapeuta_id, r.total]));
    render(res, 'pacientes', { user, terapeutas, conteo, scripts: `<script src="${req.app.locals.BASE}/pacientes.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── HISTORIAL ────────────────────────────────────────────────────
router.get('/historial', requireSession, async (req, res) => {
  const user = req.session.user;
  try {
    const qs = user.rol === 'terapeuta' ? 'WHERE terapeuta_id = ?' : 'WHERE 1';
    const [pacientes] = await db.execute(`SELECT id, nombre, apellido FROM pacientes ${qs} ORDER BY nombre`,
      user.rol === 'terapeuta' ? [user.id] : []);
    render(res, 'historial', { user, pacientes, scripts: `<script src="${req.app.locals.BASE}/history.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── DISPONIBILIDAD ──────────────────────────────────────────────
router.get('/disponibilidad', requireSession, async (req, res) => {
  const user = req.session.user;
  try {
    const isAdmin = isStaffAdmin(user.rol);
    const [terapeutas] = isAdmin
      ? await db.execute('SELECT id, nombre, apellido, username FROM terapeutas WHERE activo=1 ORDER BY nombre')
      : [[{ id: user.id, nombre: user.nombre, apellido: user.apellido, username: user.username }]];
    render(res, 'disponibilidad', { user, terapeutas, scripts: `<script src="${req.app.locals.BASE}/disponibilidad.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── TERAPEUTAS ───────────────────────────────────────────────────
router.get('/terapeutas', requireSession, requireAdmin, async (req, res) => {
  render(res, 'terapeutas', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/terapeutas.js"></script>` });
});

// ── REPORTES ─────────────────────────────────────────────────────
router.get('/reportes', requireSession, requireAdmin, async (req, res) => {
  render(res, 'reportes', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/reportes.js"></script>` });
});

// ── ANALÍTICA ────────────────────────────────────────────────────
router.get('/analitica', requireSession, requireAdmin, async (req, res) => {
  render(res, 'analitica', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/web_analytics.js"></script>` });
});

// ── CENTRAL WHATSAPP ─────────────────────────────────────────────
router.get('/whatsapp', requireSession, async (req, res) => {
  render(res, 'whatsapp', {
    user: req.session.user,
    scripts: `<script src="${req.app.locals.BASE}/whatsapp.js"></script>`,
  });
});

// ── INTEGRACIONES ────────────────────────────────────────────────
router.get('/integraciones', requireSession, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT clave, valor FROM configuracion');
    const cfg    = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    const [[cron]] = await db.execute('SELECT enabled, hora, minuto, dias, mensaje FROM cron_config WHERE id=1')
      .catch(() => [[{ enabled: 0, hora: 18, minuto: 0, dias: '1,2,3,4,5,6' }]]);
    const cronDias = String(cron?.dias || '').split(',').map(d => d.trim());
    const origin   = `${req.protocol}://${req.get('host')}`;
    const { isConnected } = require('../lib/googleMeet');
    const googleConnected = await isConnected().catch(() => false);
    render(res, 'integraciones', { user: req.session.user, cfg, cron: cron || {}, cronDias, origin, googleConnected, scripts: `<script src="${req.app.locals.BASE}/integraciones.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── PERMISOS DE MENÚ ───────────────────────────────────────────
router.get('/permisos-menu', requireSession, requireSuperAdmin, async (req, res) => {
  render(res, 'permisos_menu', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/permisos_menu.js"></script>` });
});

router.get('/api/menu-permisos', requireSession, requireSuperAdmin, async (req, res) => {
  const { listUsersWithPermisos } = require('../lib/menuPermisos');
  const users = await listUsersWithPermisos();
  res.json({ users });
});

router.post('/api/menu-permisos', requireSession, requireSuperAdmin, async (req, res) => {
  const { userId, items } = req.body || {};
  const id = parseInt(userId, 10);
  if (!id) return res.status(400).json({ error: 'userId requerido' });

  const [[user]] = await db.execute('SELECT id, rol FROM terapeutas WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { setMenuPermisosForUser } = require('../lib/menuPermisos');
  const saved = await setMenuPermisosForUser(id, items, user.rol);
  res.json({ ok: true, items: saved });
});

router.post('/api/menu-permisos/desde-rol', requireSession, requireSuperAdmin, async (req, res) => {
  const { userId } = req.body || {};
  const id = parseInt(userId, 10);
  if (!id) return res.status(400).json({ error: 'userId requerido' });

  const [[user]] = await db.execute('SELECT id, rol FROM terapeutas WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { copyMenuPermisosFromRolTemplate } = require('../lib/menuPermisos');
  const items = await copyMenuPermisosFromRolTemplate(id, user.rol);
  res.json({ ok: true, items });
});

module.exports = router;
