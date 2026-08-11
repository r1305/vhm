#!/usr/bin/env node
/**
 * cron-wsp.js — Notificación diaria de citas a terapeutas via WhatsApp (openwa)
 *
 * Configurar en cPanel → Cron Jobs:
 *   0 18 * * 1-6   /usr/local/bin/node /home/USUARIO/vhm/crm/cron-wsp.js >> /home/USUARIO/logs/cron-wsp.log 2>&1
 *
 * Corre de lunes a sábado a las 6pm y envía a cada terapeuta sus citas del día siguiente.
 */

require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./lib/db');
const { sendWhatsAppGreen } = require('./lib/greenapi');

const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmtFecha(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function fmtHora(t) { return String(t).slice(0, 5); }

async function run() {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fechaStr = manana.toISOString().slice(0, 10);

  console.log(`[cron-wsp] ${new Date().toISOString()} — Procesando citas para ${fechaStr}`);

  try {
    // Cargar config openwa desde BD
    const [cfgRows] = await pool.execute(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('openwa_url','openwa_api_key','openwa_session')"
    );
    for (const r of cfgRows) {
      if (r.clave === 'openwa_url')     process.env.OPENWA_URL     = r.valor;
      if (r.clave === 'openwa_api_key') process.env.OPENWA_API_KEY = r.valor;
      if (r.clave === 'openwa_session') process.env.OPENWA_SESSION = r.valor;
    }

    if (!process.env.OPENWA_URL || !process.env.OPENWA_API_KEY || !process.env.OPENWA_SESSION) {
      console.log('[cron-wsp] OpenWA no configurado — abortando');
      process.exit(0);
    }

    // Citas del día siguiente
    const [citas] = await pool.execute(
      `SELECT c.hora_inicio, c.modalidad,
              p.nombre AS pac_nombre, p.apellido AS pac_apellido,
              t.id AS ter_id, t.nombre AS ter_nombre, t.telefono AS ter_telefono
       FROM citas c
       JOIN pacientes p  ON c.paciente_id  = p.id
       JOIN terapeutas t ON c.terapeuta_id = t.id
       WHERE c.fecha = ? AND c.estado NOT IN ('cancelada','no_show') AND t.activo = 1
       ORDER BY t.id, c.hora_inicio`,
      [fechaStr]
    );

    if (!citas.length) {
      console.log('[cron-wsp] Sin citas para mañana');
      process.exit(0);
    }

    // Agrupar por terapeuta
    const porTerapeuta = {};
    for (const c of citas) {
      if (!porTerapeuta[c.ter_id])
        porTerapeuta[c.ter_id] = { nombre: c.ter_nombre, telefono: c.ter_telefono, citas: [] };
      porTerapeuta[c.ter_id].citas.push(c);
    }

    const ICON = { presencial: '🏢', videollamada: '💻', telefono: '📞' };

    for (const ter of Object.values(porTerapeuta)) {
      if (!ter.telefono) {
        console.log(`[cron-wsp] ${ter.nombre} sin teléfono — omitido`);
        continue;
      }

      const lineas = ter.citas.map(c =>
        `• ${fmtHora(c.hora_inicio)} — ${c.pac_nombre} ${c.pac_apellido} ${ICON[c.modalidad] || '📅'}`
      ).join('\n');

      const total = ter.citas.length;
      const mensaje =
        `Hola ${ter.nombre} 👋\n` +
        `Mañana *${fmtFecha(fechaStr)}* tienes *${total} ${total === 1 ? 'cita' : 'citas'}*:\n\n` +
        `${lineas}\n\n` +
        `_VHM Centro de Psicología_`;

      try {
        const r = await sendWhatsAppGreen({ to: ter.telefono, message: mensaje });
        if (r.skipped) console.log(`[cron-wsp] ${ter.nombre} — skipped (sin config)`);
        else           console.log(`[cron-wsp] ${ter.nombre} — enviado ✓ (${r.messageId})`);
      } catch (err) {
        console.error(`[cron-wsp] ${ter.nombre} — ERROR:`, err.message);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

  } catch (err) {
    console.error('[cron-wsp] Error fatal:', err.message);
    process.exit(1);
  }

  await pool.end().catch(() => {});
  console.log('[cron-wsp] Finalizado');
  process.exit(0);
}

run();
