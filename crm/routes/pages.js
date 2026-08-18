const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');

const TITLES = {
  dashboard:       'Dashboard',
  agenda:          'Agenda',
  pacientes:       'Pacientes',
  leads:           'Leads',
  historial:       'Historial clínico',
  consentimientos: 'Consentimientos',
  pagos:           'Pagos',
  espera:          'Lista de espera',
  terapeutas:      'Terapeutas',
  reportes:        'Reportes',
  analitica:       'Analítica web',
  marketing:       'Email Marketing',
  integraciones:   'Integraciones',
  asignacion:      'Asignación automática',
  permisos_menu:   'Permisos de menú',
};

const ESTADO_CITA_CSS = {
  pendiente:  'badge-yellow',
  confirmada: 'badge-blue',
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
  const rol = req.session?.user?.rol;
  if (rol === 'superadmin' || rol === 'recepcion') return next();
  res.redirect(`${req.app.locals.BASE}/dashboard`);
}

function requireSuperAdmin(req, res, next) {
  if (req.session?.user?.rol === 'superadmin') return next();
  res.redirect(`${req.app.locals.BASE}/dashboard`);
}

// ── Helper render con layout ─────────────────────────────────────
async function render(res, view, data = {}) {
  const BASE    = res.app.locals.BASE;
  const user    = data.user;
  const isAdmin = ['superadmin', 'recepcion'].includes(user?.rol);
  const [rows]  = await db.execute('SELECT item FROM menu_permisos WHERE rol = ?', [user?.rol || 'terapeuta']);
  const menuPermisos = new Set(rows.map(r => r.item));
  const locals  = { BASE, title: TITLES[view] || view, view, user, isAdmin, menuPermisos, scripts: '', ...data, partialView: view };
  res.render('layout', locals);
}

// ── LOGIN ────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect(`${req.app.locals.BASE}/dashboard`);
  res.render('login', { BASE: req.app.locals.BASE, error: null });
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
    const dest = user.rol === 'terapeuta' ? 'agenda' : 'dashboard';
    res.redirect(`${BASE}/${dest}`);
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
router.get('/dashboard', requireSession, requireAdmin, async (req, res) => {
  const user = req.session.user;
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const [[{ total_pacientes }]] = await db.execute('SELECT COUNT(*) AS total_pacientes FROM pacientes');
    const [[{ citas_hoy }]]       = await db.execute('SELECT COUNT(*) AS citas_hoy FROM citas WHERE fecha = ?', [hoy]);
    const [[{ leads_nuevos }]]    = await db.execute("SELECT COUNT(*) AS leads_nuevos FROM leads WHERE estado = 'nuevo'");
    const [[{ ingresos_mes }]]    = await db.execute(
      "SELECT COALESCE(SUM(monto),0) AS ingresos_mes FROM pagos WHERE estado='completado' AND DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')"
    );
    const [citasHoy]      = await db.execute(
      'SELECT c.*, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido, t.nombre AS terapeuta_nombre FROM citas c JOIN pacientes p ON p.id=c.paciente_id JOIN terapeutas t ON t.id=c.terapeuta_id WHERE c.fecha = ? ORDER BY c.fecha',
      [hoy]
    );
    const [leadsRecientes] = await db.execute('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5');

    const kpis = [
      { label: 'Pacientes activos', value: total_pacientes, css: 'accent' },
      { label: 'Citas hoy',         value: citas_hoy,       css: 'success' },
      { label: 'Leads nuevos',      value: leads_nuevos,    css: 'warning' },
      { label: 'Ingresos del mes',  value: `S/ ${parseFloat(ingresos_mes).toFixed(2)}`, css: '' },
    ];
    render(res, 'dashboard', { user, kpis, citasHoy, leadsRecientes, estadoCitaCSS: ESTADO_CITA_CSS, scripts: `<script src="${req.app.locals.BASE}/dashboard.js"></script>` });
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
    render(res, 'agenda', { user, terapeutas, pacientes, scripts: `<script src="${req.app.locals.BASE}/agenda.js"></script>` });
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

// ── LEADS ────────────────────────────────────────────────────────
router.get('/leads', requireSession, requireAdmin, async (req, res) => {
  render(res, 'leads', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/leads.js"></script>` });
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

// ── CONSENTIMIENTOS ──────────────────────────────────────────────
router.get('/consentimientos', requireSession, requireAdmin, async (req, res) => {
  const [pacientes] = await db.execute('SELECT id, nombre, apellido FROM pacientes ORDER BY nombre');
  render(res, 'consentimientos', { user: req.session.user, pacientes, scripts: `<script src="${req.app.locals.BASE}/consent.js"></script>` });
});

// ── PAGOS ────────────────────────────────────────────────────────
router.get('/pagos', requireSession, requireAdmin, async (req, res) => {
  const [pacientes] = await db.execute('SELECT id, nombre, apellido FROM pacientes ORDER BY nombre');
  render(res, 'pagos', { user: req.session.user, pacientes, scripts: `<script src="${req.app.locals.BASE}/payment.js"></script>` });
});

// ── ESPERA ───────────────────────────────────────────────────────
router.get('/espera', requireSession, requireAdmin, async (req, res) => {
  render(res, 'espera', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/queue.js"></script>` });
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

// ── MARKETING ────────────────────────────────────────────────────
router.get('/marketing', requireSession, requireAdmin, async (req, res) => {
  render(res, 'marketing', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/marketing.js"></script>` });
});

// ── ASIGNACIÓN ───────────────────────────────────────────────────
router.get('/asignacion', requireSession, requireAdmin, async (req, res) => {
  render(res, 'asignacion', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/auto_assignment.js"></script>` });
});

// ── INTEGRACIONES ────────────────────────────────────────────────
router.get('/integraciones', requireSession, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT clave, valor FROM configuracion');
    const cfg    = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    const [[cron]] = await db.execute('SELECT enabled, hora, minuto, dias FROM cron_config WHERE id=1')
      .catch(() => [[{ enabled: 0, hora: 18, minuto: 0, dias: '1,2,3,4,5,6' }]]);
    const cronDias = String(cron?.dias || '').split(',').map(d => d.trim());
    const origin   = `${req.protocol}://${req.get('host')}`;
    render(res, 'integraciones', { user: req.session.user, cfg, cron: cron || {}, cronDias, origin, scripts: `<script src="${req.app.locals.BASE}/integraciones.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── PERMISOS DE MENÚ ───────────────────────────────────────────
router.get('/permisos-menu', requireSession, requireSuperAdmin, async (req, res) => {
  render(res, 'permisos_menu', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/permisos_menu.js"></script>` });
});

router.get('/api/menu-permisos', requireSession, requireSuperAdmin, async (req, res) => {
  const [rows] = await db.execute('SELECT rol, item FROM menu_permisos ORDER BY rol, item');
  const result = {};
  for (const r of rows) {
    if (!result[r.rol]) result[r.rol] = [];
    result[r.rol].push(r.item);
  }
  res.json(result);
});

router.post('/api/menu-permisos', requireSession, requireSuperAdmin, async (req, res) => {
  const { rol, items } = req.body;
  const roles = ['superadmin', 'recepcion', 'terapeuta'];
  if (!roles.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  // superadmin siempre tiene permisos_menu
  const safeItems = Array.isArray(items) ? items : [];
  if (rol === 'superadmin' && !safeItems.includes('permisos_menu')) safeItems.push('permisos_menu');
  await db.execute('DELETE FROM menu_permisos WHERE rol = ?', [rol]);
  for (const item of safeItems)
    await db.execute('INSERT IGNORE INTO menu_permisos (rol, item) VALUES (?,?)', [rol, item]);
  res.json({ ok: true });
});

module.exports = router;
