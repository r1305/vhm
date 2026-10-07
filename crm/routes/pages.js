const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');
const { getHomePath } = require('../lib/crmNav');
const { isStaffAdmin, isSuperAdmin } = require('../lib/roles');
const { SQL } = require('../lib/paquetesPaciente');

const TITLES = {
  encuestas:       'Encuestas',
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
  paquetes:        'Paquetes',
  whatsapp:        'Central WhatsApp',
  asignacion:      'Asignación automática',
  calendario:      'Calendario',
  disponibilidad:  'Mi disponibilidad',
  permisos_menu:        'Permisos de menú',
  reporte_financiero:   'Reporte Financiero · Dashboard',
  reporte_financiero_detalles: 'Reporte Financiero · Detalles',
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
      'SELECT id, nombre, apellido, username, especialidad, presencial_habilitado FROM terapeutas WHERE username=? AND activo=1',
      [req.params.username]
    );
    if (!terapeuta) return res.status(404).send('Terapeuta no encontrado');
    res.render('agendar', { BASE: req.app.locals.BASE, terapeuta });
  } catch (err) { res.status(500).send(err.message); }
});

// Encuesta pública
router.get('/encuesta/:slug', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('encuesta_publica', { BASE: req.app.locals.BASE, slug: req.params.slug });
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
    res.render('login', { BASE, error: err.message, assetVersion: req.app.locals.assetVersion });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect(`${req.app.locals.BASE}/login`));
});

// ── MI REPORTE (terapeutas) ──────────────────────────────────────
router.get('/mi-reporte', requireSession, (req, res) => {
  render(res, 'mi_reporte', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/mi_reporte.js"></script>` });
});

router.get('/encuestas', requireSession, async (req, res) => {
  render(res, 'encuestas', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/encuestas.js?v=${req.app.locals.assetVersion}"></script>` });
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
    const [
      [ [{ pacientes_activos }] ],
      [ [{ retenidos }] ],
      [ [{ altas_mes }] ],
      [ [{ sin_paquete }] ],
      [ [{ leads_mes }] ],
      [ [{ convertidos_mes }] ],
      [ [{ no_show_mes }] ],
      [ [{ citas_mes }] ],
      [ [{ lista_espera }] ],
      [ proximosAgotar ],
      [ enRiesgo ],
      [ sinPaquete ],
      [ packVencidos ],
      [ ocupacion ]
    ] = await Promise.all([
      db.execute("SELECT COUNT(*) AS pacientes_activos FROM pacientes WHERE estado = 'activo'"),
      db.execute(`SELECT COUNT(*) AS retenidos FROM pacientes p WHERE p.estado='activo' AND ${SQL.paquetesComprados('p')} >= 2`),
      db.execute("SELECT COUNT(*) AS altas_mes FROM pacientes WHERE estado='alta' AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')"),
      db.execute(`SELECT COUNT(*) AS sin_paquete FROM pacientes p WHERE p.estado='activo' AND ${SQL.sinSesiones('p')}`),
      db.execute("SELECT COUNT(*) AS leads_mes FROM leads WHERE DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')"),
      db.execute("SELECT COUNT(*) AS convertidos_mes FROM leads WHERE estado='convertido' AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')"),
      db.execute("SELECT COUNT(*) AS no_show_mes FROM citas WHERE estado='no_show' AND DATE_FORMAT(fecha,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')"),
      db.execute("SELECT COUNT(*) AS citas_mes FROM citas WHERE estado IN ('realizada','no_show') AND DATE_FORMAT(fecha,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')"),
      db.execute('SELECT COUNT(*) AS lista_espera FROM lista_espera WHERE activo=1'),
      db.execute(`
        SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
               ${SQL.sesionesTotal('p')}          AS sesiones_total,
               ${SQL.citasConfirmadas('p')}       AS sesiones_usadas,
               ${SQL.sesionesPendientes('p')}     AS sesiones_restantes,
               ${SQL.paqueteNombre('p')}          AS paquete_nombre
        FROM pacientes p LEFT JOIN terapeutas t ON p.terapeuta_id = t.id
        WHERE p.estado = 'activo'
          AND ${SQL.paqueteNombre('p')} IS NOT NULL
          AND ${SQL.sesionesPendientes('p')} <= 2
        ORDER BY ${SQL.sesionesPendientes('p')} ASC, p.nombre ASC
        LIMIT 15
      `),
      db.execute(`
        SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
               MAX(c.fecha) AS ultima_cita
        FROM pacientes p
        LEFT JOIN terapeutas t ON t.id = p.terapeuta_id
        LEFT JOIN citas c ON c.paciente_id = p.id AND c.estado = 'realizada'
        WHERE p.estado = 'activo'
        GROUP BY p.id
        HAVING ultima_cita IS NULL OR ultima_cita < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY ultima_cita ASC
        LIMIT 15
      `),
      db.execute(`
        SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
               p.created_at
        FROM pacientes p LEFT JOIN terapeutas t ON t.id = p.terapeuta_id
        WHERE p.estado = 'activo' AND ${SQL.sinSesiones('p')}
        ORDER BY p.created_at DESC LIMIT 10
      `),
      db.execute(`
        SELECT p.id, p.nombre, p.apellido, p.telefono, t.nombre AS terapeuta_nombre,
               pp.nombre AS pack_nombre, pp.vence_at,
               (pp.sesiones - (
                 SELECT COUNT(*) FROM citas c
                 WHERE c.paciente_id = p.id AND c.estado IN ('realizada','no_show')
                   AND DATE(c.fecha) >= DATE(pp.fecha_inicio)
               )) AS sesiones_restantes
        FROM paciente_paquetes pp
        JOIN pacientes p ON p.id = pp.paciente_id
        LEFT JOIN terapeutas t ON t.id = p.terapeuta_id
        WHERE pp.vence_at < CURDATE()
          AND (pp.sesiones - (
            SELECT COUNT(*) FROM citas c
            WHERE c.paciente_id = p.id AND c.estado IN ('realizada','no_show')
              AND DATE(c.fecha) >= DATE(pp.fecha_inicio)
          )) > 0
        ORDER BY pp.vence_at ASC LIMIT 10
      `),
      db.execute(`
        SELECT t.id, t.nombre, t.apellido,
               COUNT(p.id) AS pacientes_asignados
        FROM terapeutas t
        LEFT JOIN pacientes p ON p.terapeuta_id = t.id AND p.estado = 'activo'
        WHERE t.activo = 1 AND t.rol = 'terapeuta'
        GROUP BY t.id ORDER BY pacientes_asignados DESC
      `)
    ]);

    const tasaRetencion   = pacientes_activos > 0 ? Math.round((retenidos / pacientes_activos) * 100) : 0;
    const tasaConversion  = leads_mes > 0 ? Math.round((convertidos_mes / leads_mes) * 100) : 0;
    const tasaNoShow      = citas_mes > 0 ? Math.round((no_show_mes / citas_mes) * 100) : 0;

    const kpis = [
      { label: 'Pacientes activos',   value: pacientes_activos, sub: null, state: null },
      { label: 'Tasa de retención',   value: `${tasaRetencion}%`, sub: `${retenidos} con 2+ paquetes`, state: tasaRetencion >= 50 ? 'ok' : 'warn' },
      { label: 'Conversión leads',    value: `${tasaConversion}%`, sub: `${convertidos_mes} de ${leads_mes} este mes`, state: tasaConversion >= 30 ? 'ok' : 'warn' },
      { label: 'No-show del mes',     value: `${tasaNoShow}%`, sub: `${no_show_mes} de ${citas_mes} citas`, state: tasaNoShow > 15 ? 'warn' : 'ok' },
      { label: 'Altas este mes',      value: altas_mes, sub: 'tratamientos finalizados', state: null },
      { label: 'Sin sesiones',        value: sin_paquete, sub: 'activos que nunca compraron', state: sin_paquete > 0 ? 'warn' : null },
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
    const [terapeutas] = await db.execute("SELECT id, nombre, apellido FROM terapeutas WHERE activo=1 AND rol='terapeuta' ORDER BY nombre");
    render(res, 'calendario', { user, terapeutas, scripts: `<script src="${req.app.locals.BASE}/citas_modal.js"></script><script src="${req.app.locals.BASE}/calendario.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── AGENDA ───────────────────────────────────────────────────────
router.get('/agenda', requireSession, async (req, res) => {
  const user = req.session.user;
  try {
    const [terapeutas] = await db.execute("SELECT id, nombre, apellido FROM terapeutas WHERE activo=1 AND rol='terapeuta' ORDER BY nombre");
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
    const [terapeutas] = await db.execute("SELECT id, nombre, apellido FROM terapeutas WHERE activo=1 AND rol='terapeuta' ORDER BY nombre");
    const [rows]       = await db.execute('SELECT terapeuta_id, COUNT(*) AS total FROM pacientes GROUP BY terapeuta_id');
    const conteo       = Object.fromEntries(rows.map(r => [r.terapeuta_id, r.total]));
    render(res, 'pacientes', { user, terapeutas, conteo, scripts: `<script src="${req.app.locals.BASE}/cuotasPlan.js"></script><script src="${req.app.locals.BASE}/pacientes.js"></script>` });
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
      ? await db.execute("SELECT id, nombre, apellido, username FROM terapeutas WHERE activo=1 AND rol='terapeuta' ORDER BY nombre")
      : [[{ id: user.id, nombre: user.nombre, apellido: user.apellido, username: user.username }]];
    render(res, 'disponibilidad', { user, terapeutas, scripts: `<script src="${req.app.locals.BASE}/disponibilidad.js"></script>` });
  } catch (err) { res.status(500).send(err.message); }
});

// ── TERAPEUTAS ───────────────────────────────────────────────────
router.get('/terapeutas', requireSession, requireAdmin, async (req, res) => {
  render(res, 'terapeutas', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/terapeutas.js"></script>` });
});

router.get('/paquetes', requireSession, requireAdmin, async (req, res) => {
  render(res, 'paquetes', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/paquetes.js"></script>` });
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

// ── REPORTE FINANCIERO ──────────────────────────────────────────
router.get('/reporte-financiero', requireSession, requireAdmin, async (req, res) => {
  try {
    const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const desde = req.query.desde;
    const hasta = req.query.hasta;
    const hayRango = esFecha(desde) && esFecha(hasta) && desde <= hasta;
    const filterDate = (col) => {
      if (!hayRango) return '';
      return ` AND ${col} BETWEEN ${db.escape(desde + ' 00:00:00')} AND ${db.escape(hasta + ' 23:59:59')}`;
    };
    const fechaCobro = 'COALESCE(c.pagado_at, c.fecha_pago)';
    const desdeSeisMeses = `AND pp.created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 5 MONTH), '%Y-%m-01')`;
    const cobroSeisMeses = `AND ${fechaCobro} >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 5 MONTH), '%Y-%m-01')`;

    const mesKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const spineMeses = () => {
      const out = [];
      if (hayRango) {
        let [y, m] = desde.slice(0, 7).split('-').map(Number);
        const [y2, m2] = hasta.slice(0, 7).split('-').map(Number);
        while ((y < y2 || (y === y2 && m <= m2)) && out.length <= 72) {
          out.push(mesKey(y, m));
          m += 1; if (m > 12) { m = 1; y += 1; }
        }
      } else {
        const now = new Date();
        let y = now.getFullYear(), m = now.getMonth() + 1;
        for (let i = 0; i < 6; i++) {
          out.unshift(mesKey(y, m));
          m -= 1; if (m < 1) { m = 12; y -= 1; }
        }
      }
      return out;
    };

    const [
      [ [{ ingreso_total }] ],
      [ [{ ingreso_mes }] ],
      [ [{ ingreso_mes_anterior }] ],
      [ [{ deuda_pendiente }] ],
      [ [{ ticket_promedio }] ],
      [ [{ paquetes_vendidos }] ],
      [ [{ paquetes_mes }] ],
      [ [{ pago_parcial_pendiente }] ],
      [ [{ total_cuotas, cuotas_pagadas }] ],
      [ vendidosPorMes ],
      [ cobradosPorMes ],
      [ ingresosPorPaquete ],
      [ ingresosPorTerapeuta ]
    ] = await Promise.all([
      db.execute(`SELECT COALESCE(SUM(c.monto),0) AS ingreso_total FROM paciente_paquete_cuotas c WHERE c.pagado = 1 ${filterDate(fechaCobro)}`),
      db.execute(`SELECT COALESCE(SUM(c.monto),0) AS ingreso_mes FROM paciente_paquete_cuotas c WHERE c.pagado = 1 AND DATE_FORMAT(${fechaCobro},'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')`),
      db.execute(`SELECT COALESCE(SUM(c.monto),0) AS ingreso_mes_anterior FROM paciente_paquete_cuotas c WHERE c.pagado = 1 AND DATE_FORMAT(${fechaCobro},'%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH),'%Y-%m')`),
      db.execute(`SELECT COALESCE(SUM(c.monto),0) AS deuda_pendiente FROM paciente_paquete_cuotas c INNER JOIN paciente_paquetes pp ON pp.id = c.paciente_paquete_id WHERE c.pagado = 0`),
      db.execute(`SELECT COALESCE(AVG(pp.precio),0) AS ticket_promedio FROM paciente_paquetes pp`),
      db.execute(`SELECT COUNT(*) AS paquetes_vendidos FROM paciente_paquetes WHERE 1=1 ${filterDate('created_at')}`),
      db.execute(`SELECT COUNT(*) AS paquetes_mes FROM paciente_paquetes WHERE DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')`),
      db.execute(`SELECT COUNT(DISTINCT pp.id) AS pago_parcial_pendiente FROM paciente_paquetes pp INNER JOIN paciente_paquete_cuotas c ON c.paciente_paquete_id = pp.id WHERE pp.tipo_pago = 'parcial' AND c.pagado = 0`),
      db.execute(`SELECT COUNT(*) AS total_cuotas, SUM(pagado) AS cuotas_pagadas FROM paciente_paquete_cuotas`),
      db.execute(`SELECT DATE_FORMAT(pp.created_at,'%Y-%m') AS mes, COALESCE(SUM(pp.precio),0) AS total FROM paciente_paquetes pp WHERE 1=1 ${filterDate('pp.created_at') || desdeSeisMeses} GROUP BY mes`),
      db.execute(`SELECT DATE_FORMAT(${fechaCobro},'%Y-%m') AS mes, COALESCE(SUM(c.monto),0) AS total FROM paciente_paquete_cuotas c WHERE c.pagado = 1 ${filterDate(fechaCobro) || cobroSeisMeses} GROUP BY mes`),
      db.execute(`SELECT pp.nombre, COUNT(*) AS veces_vendido, COALESCE(SUM(pp.precio),0) AS ingreso_bruto, COALESCE(SUM(CASE WHEN c.pagado=1 THEN c.monto ELSE 0 END),0) AS ingreso_cobrado FROM paciente_paquetes pp LEFT JOIN paciente_paquete_cuotas c ON c.paciente_paquete_id = pp.id ${filterDate('pp.created_at')} GROUP BY pp.nombre ORDER BY ingreso_cobrado DESC LIMIT 10`),
      db.execute(`SELECT t.nombre, t.apellido, COUNT(DISTINCT pp.id) AS paquetes, COALESCE(SUM(pp.precio),0) AS ingreso_bruto, COALESCE(SUM(CASE WHEN c.pagado=1 THEN c.monto ELSE 0 END),0) AS ingreso_cobrado FROM paciente_paquetes pp INNER JOIN pacientes p ON p.id = pp.paciente_id LEFT JOIN terapeutas t ON t.id = p.terapeuta_id LEFT JOIN paciente_paquete_cuotas c ON c.paciente_paquete_id = pp.id ${filterDate('pp.created_at')} GROUP BY t.id ORDER BY ingreso_cobrado DESC`)
    ]);

    const vendidoMap = Object.fromEntries(vendidosPorMes.map(r => [r.mes, Number(r.total)]));
    const cobradoMap = Object.fromEntries(cobradosPorMes.map(r => [r.mes, Number(r.total)]));
    const ingresosPorMes = spineMeses().map(mes => ({
      mes,
      vendido: vendidoMap[mes] || 0,
      cobrado: cobradoMap[mes] || 0,
    }));

    const fmtFecha = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    const rangoTexto = hayRango ? `del ${fmtFecha(desde)} al ${fmtFecha(hasta)}` : 'últimos 6 meses';

    const variacion_mes = ingreso_mes_anterior > 0
      ? Math.round(((ingreso_mes - ingreso_mes_anterior) / ingreso_mes_anterior) * 100)
      : null;

    render(res, 'reporte_financiero', {
      user: req.session.user,
      ingreso_total, ingreso_mes, ingreso_mes_anterior, variacion_mes,
      deuda_pendiente, ticket_promedio, paquetes_vendidos, paquetes_mes,
      pago_parcial_pendiente, tasa_cobro: total_cuotas > 0 ? Math.round((cuotas_pagadas / total_cuotas) * 100) : 0, total_cuotas, cuotas_pagadas,
      ingresosPorMes, rangoTexto, ingresosPorPaquete, ingresosPorTerapeuta,
      desde: hayRango ? desde : '',
      hasta: hayRango ? hasta : '',
      scripts: `<script src="${req.app.locals.BASE}/reportes.js"></script>`,
    });
  } catch (err) { res.status(500).send(err.message); }
});

// ── REPORTE FINANCIERO · DETALLES (paquetes paginados) ─────────
router.get('/reporte-financiero/detalles', requireSession, requireAdmin, async (req, res) => {
  try {
    const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const desde = req.query.desde;
    const hasta = req.query.hasta;
    const hayRango = esFecha(desde) && esFecha(hasta) && desde <= hasta;
    const filterDate = (col) => {
      if (!hayRango) return '';
      return ` AND ${col} BETWEEN ${db.escape(desde + ' 00:00:00')} AND ${db.escape(hasta + ' 23:59:59')}`;
    };
    const desdeSeisMeses = `AND pp.created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 5 MONTH), '%Y-%m-01')`;
    const where = `WHERE 1=1 ${filterDate('pp.created_at') || desdeSeisMeses}`;

    const pageSize = 25;
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);

    const [[{ total, vendido, cobrado }]] = await db.execute(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(t.vendido),0) AS vendido,
             COALESCE(SUM(t.cobrado),0) AS cobrado
      FROM (
        SELECT pp.id, MAX(pp.precio) AS vendido,
               COALESCE(SUM(CASE WHEN c.pagado = 1 THEN c.monto ELSE 0 END),0) AS cobrado
        FROM paciente_paquetes pp
        LEFT JOIN paciente_paquete_cuotas c ON c.paciente_paquete_id = pp.id
        ${where}
        GROUP BY pp.id
      ) t`);

    const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
    const paginaAjustada = Math.min(pagina, totalPaginas);

    const [[detalleVentas], [cuotasVencidas], [cuotasProximas]] = await Promise.all([
      db.execute(
        `SELECT pp.id, pp.nombre AS paquete, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido,
          DATE(pp.created_at) AS fecha_registro, DATE(pp.fecha_inicio) AS fecha_activacion,
          pp.precio, pp.tipo_pago, COUNT(c.id) AS cuotas_total, COALESCE(SUM(c.pagado),0) AS cuotas_pagadas,
          COALESCE(SUM(CASE WHEN c.pagado = 1 THEN c.monto ELSE 0 END),0) AS cobrado
          FROM paciente_paquetes pp
          INNER JOIN pacientes p ON p.id = pp.paciente_id
          LEFT JOIN paciente_paquete_cuotas c ON c.paciente_paquete_id = pp.id
          ${where}
          GROUP BY pp.id, p.id
          ORDER BY pp.created_at DESC
          LIMIT ${pageSize} OFFSET ${(paginaAjustada - 1) * pageSize}`
      ),
      db.execute(`SELECT p.nombre, p.apellido, p.telefono, pp.nombre AS paquete_nombre, c.numero AS cuota_num, c.monto, c.fecha_pago FROM paciente_paquete_cuotas c INNER JOIN paciente_paquetes pp ON pp.id = c.paciente_paquete_id INNER JOIN pacientes p ON p.id = pp.paciente_id WHERE c.pagado = 0 AND c.fecha_pago < CURDATE() ORDER BY c.fecha_pago ASC LIMIT 20`),
      db.execute(`SELECT p.nombre, p.apellido, p.telefono, pp.nombre AS paquete_nombre, c.numero AS cuota_num, c.monto, c.fecha_pago FROM paciente_paquete_cuotas c INNER JOIN paciente_paquetes pp ON pp.id = c.paciente_paquete_id INNER JOIN pacientes p ON p.id = pp.paciente_id WHERE c.pagado = 0 AND c.fecha_pago BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY) ORDER BY c.fecha_pago ASC LIMIT 20`)
    ]);

    const fmtFechaTexto = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    const rangoTexto = hayRango ? `del ${fmtFechaTexto(desde)} al ${fmtFechaTexto(hasta)}` : 'últimos 6 meses';

    render(res, 'reporte_financiero_detalles', {
      user: req.session.user,
      detalleVentas, total, vendido, cobrado,
      pagina: paginaAjustada, totalPaginas,
      cuotasVencidas, cuotasProximas, rangoTexto,
      desde: hayRango ? desde : '',
      hasta: hayRango ? hasta : '',
      scripts: `<script src="${req.app.locals.BASE}/reportes.js"></script>`,
    });
  } catch (err) { res.status(500).send(err.message); }
});

// ── PERMISOS DE MENÚ ───────────────────────────────────────────
router.get('/permisos-menu', requireSession, requireSuperAdmin, async (req, res) => {
  render(res, 'permisos_menu', { user: req.session.user, scripts: `<script src="${req.app.locals.BASE}/permisos_menu.js"></script>` });
});

router.get('/api/menu-permisos/catalogo', requireSession, requireSuperAdmin, async (req, res) => {
  const { getCatalog } = require('../lib/menuPermisos');
  const catalog = await getCatalog();
  res.json({ items: catalog });
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
