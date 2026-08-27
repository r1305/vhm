#!/usr/bin/env node
/**
 * cron-wsp.js — Recordatorio WhatsApp a todos los terapeutas (openwa)
 *
 * Envía el mensaje guardado en cron_config a todos los terapeutas activos con teléfono.
 * El horario y días los controla node-cron en app.js (America/Lima).
 * Anti-duplicado: máximo un envío automático por día (tabla cron_send_guard).
 *
 * CLI opcional (cPanel Cron, respeta días/enabled de cron_config):
 *   0 18 * * 1-6   node /home/USUARIO/vhm/crm/cron-wsp.js >> logs/cron-wsp.log 2>&1
 * Si usas node-cron en app.js, no configures también el CLI (mismo guard evita doble envío).
 */

require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./lib/db');
const { sendWhatsAppGreen, loadOpenwaConfigFromDB, isOpenwaConfigured } = require('./lib/greenapi');

const LIMA_DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getLimaDayOfWeek() {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'short' }).format(new Date());
  return LIMA_DOW[short];
}

function getLimaDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

/** @returns {{ acquired: boolean, guardKey: string }} */
async function tryAcquireAutoSendGuard() {
  const guardKey = `wsp_terapeutas:auto:${getLimaDateKey()}`;
  try {
    await pool.execute('INSERT INTO cron_send_guard (guard_key) VALUES (?)', [guardKey]);
    return { acquired: true, guardKey };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return { acquired: false, guardKey };
    throw err;
  }
}

async function cleanupOldSendGuards() {
  await pool.execute(
    'DELETE FROM cron_send_guard WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)'
  );
}

async function loadCronConfig() {
  const [[row]] = await pool.execute(
    'SELECT enabled, hora, minuto, dias, mensaje FROM cron_config WHERE id=1'
  );
  return row || { enabled: 0, hora: 18, minuto: 0, dias: '1,2,3,4,5,6', mensaje: '' };
}

function isCronDayToday(dias) {
  const today = String(getLimaDayOfWeek());
  return String(dias || '')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)
    .includes(today);
}

function personalizeMessage(template, nombre) {
  return String(template).replace(/\{nombre\}/gi, nombre || '');
}

async function sendBroadcastToTerapeutas(message) {
  const stats = { enviados: 0, omitidos: 0, errores: [] };

  const [terapeutas] = await pool.execute(
    "SELECT nombre, telefono FROM terapeutas WHERE activo=1 AND telefono IS NOT NULL AND telefono != ''"
  );

  if (!terapeutas.length) {
    console.log('[cron-wsp] Ningún terapeuta activo con teléfono');
    return stats;
  }

  for (const t of terapeutas) {
    const text = personalizeMessage(message, t.nombre);
    try {
      const r = await sendWhatsAppGreen({ to: t.telefono, message: text });
      if (r.skipped) {
        console.log(`[cron-wsp] ${t.nombre} — skipped (sin config)`);
        stats.omitidos++;
      } else {
        console.log(`[cron-wsp] ${t.nombre} — enviado ✓`);
        stats.enviados++;
      }
    } catch (err) {
      console.error(`[cron-wsp] ${t.nombre} — ERROR:`, err.message);
      stats.errores.push({ terapeuta: t.nombre, error: err.message });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  return stats;
}

/**
 * @param {{ manual?: boolean }} opts — manual=true omite chequeo de día/enabled (Ejecutar ahora)
 */
async function runCronWSP(opts = {}) {
  const manual = !!opts.manual;
  const cron = await loadCronConfig();

  const stats = {
    ok: true,
    enviados: 0,
    omitidos: 0,
    errores: [],
    sinConfig: false,
    sinMensaje: false,
    omitido: false,
    motivo: null,
    duplicado: false,
  };

  if (!manual) {
    if (!cron.enabled) {
      console.log('[cron-wsp] Cron desactivado — omitido');
      stats.omitido = true;
      stats.motivo = 'disabled';
      return stats;
    }
    if (!isCronDayToday(cron.dias)) {
      console.log('[cron-wsp] Hoy no es día de envío — omitido');
      stats.omitido = true;
      stats.motivo = 'wrong_day';
      return stats;
    }
  }

  const message = (cron.mensaje || '').trim();
  if (!message) {
    console.log('[cron-wsp] Sin mensaje configurado en cron_config — abortando');
    stats.sinMensaje = true;
    stats.ok = false;
    return stats;
  }

  await loadOpenwaConfigFromDB();
  if (!isOpenwaConfigured()) {
    console.log('[cron-wsp] OpenWA no configurado — abortando');
    stats.sinConfig = true;
    stats.ok = false;
    return stats;
  }

  if (!manual) {
    const guard = await tryAcquireAutoSendGuard();
    if (!guard.acquired) {
      console.log(`[cron-wsp] Envío automático ya realizado hoy (${guard.guardKey}) — omitido (anti-duplicado)`);
      stats.omitido = true;
      stats.motivo = 'duplicate';
      stats.duplicado = true;
      return stats;
    }
    cleanupOldSendGuards().catch(err => {
      console.warn('[cron-wsp] Limpieza cron_send_guard:', err.message);
    });
  }

  console.log(`[cron-wsp] ${new Date().toISOString()} — Enviando recordatorio a terapeutas`);

  const result = await sendBroadcastToTerapeutas(message);
  Object.assign(stats, result);

  console.log('[cron-wsp] Finalizado — enviados:', stats.enviados, 'omitidos:', stats.omitidos);
  return stats;
}

async function runCli() {
  let exitCode = 0;
  try {
    const stats = await runCronWSP({ manual: false });
    if (stats.sinConfig || stats.sinMensaje) exitCode = 1;
    else if (stats.omitido) exitCode = 0;
    else if (stats.errores.length) exitCode = 1;
  } catch (err) {
    console.error('[cron-wsp] Error fatal:', err.message);
    exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    process.exit(exitCode);
  }
}

module.exports = {
  runCronWSP,
  sendBroadcastToTerapeutas,
  loadCronConfig,
  tryAcquireAutoSendGuard,
  getLimaDateKey,
};

if (require.main === module) runCli();
