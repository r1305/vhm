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
  calendario:      'Calendario',
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
    const [[{ pacientes_activos }]] = await db.execute("SELECT COUNT(*) AS pacientes_activos FROM pacientes WHERE estado = 'activo'");
    const [[{ ingresos_mes }]]      = await db.execute("SELECT COALESCE(SUM(monto),0) AS ingresos_mes FROM pagos WHERE estado='completado' AND DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')");
    const [[{ ingresos_mes_ant }]]  = await db.execute("SELECT COALESCE(SUM(monto),0) AS ingresos_mes_ant FROM pagos WHERE estado='completado' AND DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH),'%Y-%m')");
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
    const varMes          = ingresos_mes_ant > 0 ? ((ingresos_mes - ingresos_mes_ant) / ingresos_mes_ant * 100).toFixed(1) : null;

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
      { label: 'Pacientes activos',   value: pacientes_activos, css: 'accent' },
      { label: 'Ingresos del mes',    value: `S/ ${parseFloat(ingresos_mes).toFixed(2)}`, sub: varMes !== null ? `${varMes > 0 ? '+' : ''}${varMes}% vs mes anterior` : null, css: '' },
      { label: 'Tasa de retención',   value: `${tasaRetencion}%`, sub: `${retenidos} con 2+ paquetes`, css: tasaRetencion >= 50 ? 'success' : 'warning' },
      { label: 'Conversión leads',    value: `${tasaConversion}%`, sub: `${convertidos_mes} de ${leads_mes} este mes`, css: tasaConversion >= 30 ? 'success' : 'warning' },
      { label: 'No-show del mes',     value: `${tasaNoShow}%`, sub: `${no_show_mes} de ${citas_mes} citas`, css: tasaNoShow > 15 ? 'warning' : 'success' },
      { label: 'Altas este mes',      value: altas_mes, sub: 'tratamientos finalizados', css: '' },
      { label: 'Sin paquete activo',  value: sin_paquete, sub: 'pacientes activos', css: sin_paquete > 0 ? 'warning' : 'success' },
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
    render(res, 'calendario', { user, terapeutas, scripts: `<script src="${req.app.locals.BASE}/calendario.js"></script>` });
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
    const [[cron]] = await db.execute('SELECT enabled, hora, minuto, dias, mensaje FROM cron_config WHERE id=1')
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
