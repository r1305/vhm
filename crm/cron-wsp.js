#!/usr/bin/env node
/**
 * cron-wsp.js — Notificación diaria de citas a terapeutas via WhatsApp (openwa)
 *
 * cPanel Cron (CLI):
 *   0 18 * * 1-6   node /home/USUARIO/vhm/crm/cron-wsp.js >> logs/cron-wsp.log 2>&1
 *
 * También invocable desde el CRM (Integraciones → Ejecutar ahora) sin matar el servidor.
 */

require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./lib/db');
const { sendWhatsAppGreen, loadOpenwaConfigFromDB, isOpenwaConfigured } = require('./lib/greenapi');

const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmtFecha(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

async function runCronWSP() {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fechaStr = manana.toISOString().slice(0, 10);

  const stats = {
    ok: true,
    fecha: fechaStr,
    enviados: 0,
    omitidos: 0,
    errores: [],
    sinConfig: false,
    sinCitas: false,
  };

  console.log(`[cron-wsp] ${new Date().toISOString()} — Procesando citas para ${fechaStr}`);

  await loadOpenwaConfigFromDB();
  if (!isOpenwaConfigured()) {
    console.log('[cron-wsp] OpenWA no configurado — abortando');
    stats.sinConfig = true;
    stats.ok = false;
    return stats;
  }

  const [citas] = await pool.execute(
    `SELECT c.fecha, c.modalidad,
            p.nombre AS pac_nombre, p.apellido AS pac_apellido,
            t.id AS ter_id, t.nombre AS ter_nombre, t.telefono AS ter_telefono
     FROM citas c
     JOIN pacientes p  ON c.paciente_id  = p.id
     JOIN terapeutas t ON c.terapeuta_id = t.id
     WHERE c.fecha = ? AND c.estado NOT IN ('cancelada','no_show') AND t.activo = 1
     ORDER BY t.id`,
    [fechaStr]
  );

  if (!citas.length) {
    console.log('[cron-wsp] Sin citas para mañana');
    stats.sinCitas = true;
    return stats;
  }

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
      stats.omitidos++;
      continue;
    }

    const lineas = ter.citas.map(c =>
      `• ${c.pac_nombre} ${c.pac_apellido} ${ICON[c.modalidad] || '📅'}`
    ).join('\n');

    const total = ter.citas.length;
    const mensaje =
      `Hola ${ter.nombre} 👋\n` +
      `Mañana *${fmtFecha(fechaStr)}* tienes *${total} ${total === 1 ? 'cita' : 'citas'}*:\n\n` +
      `${lineas}\n\n` +
      `_VHM Centro de Psicología_`;

    try {
      const r = await sendWhatsAppGreen({ to: ter.telefono, message: mensaje });
      if (r.skipped) {
        console.log(`[cron-wsp] ${ter.nombre} — skipped (sin config)`);
        stats.omitidos++;
      } else {
        console.log(`[cron-wsp] ${ter.nombre} — enviado ✓ (${r.messageId || 'ok'})`);
        stats.enviados++;
      }
    } catch (err) {
      console.error(`[cron-wsp] ${ter.nombre} — ERROR:`, err.message);
      stats.errores.push({ terapeuta: ter.nombre, error: err.message });
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('[cron-wsp] Finalizado — enviados:', stats.enviados, 'omitidos:', stats.omitidos);
  return stats;
}

async function runCli() {
  let exitCode = 0;
  try {
    const stats = await runCronWSP();
    if (stats.sinConfig) exitCode = 0;
    else if (stats.errores.length) exitCode = 1;
  } catch (err) {
    console.error('[cron-wsp] Error fatal:', err.message);
    exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    process.exit(exitCode);
  }
}

module.exports = { runCronWSP };

if (require.main === module) runCli();
