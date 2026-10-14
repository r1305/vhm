let _cronTask = null;
let _cronRec24Task = null;
let _detenido = true;

async function scheduleCron() {
  try {
    const nodeCron = require('node-cron');
    const db = require('./lib/db');
    const [[cfg]] = await db.execute('SELECT enabled, hora, minuto, dias FROM cron_config WHERE id=1');
    if (_cronTask) { _cronTask.stop(); _cronTask = null; }
    if (_detenido) return;
    if (!cfg || !cfg.enabled) { console.log('[cron] Desactivado (enabled=' + (cfg?.enabled) + ')'); return; }
    const expr = `${cfg.minuto} ${cfg.hora} * * ${cfg.dias}`;
    _cronTask = nodeCron.schedule(expr, () => {
      console.log('[cron] Ejecutando cron-wsp...');
      require('./cron-wsp').runCronWSP().catch(e => console.error('[cron]', e.message));
    }, { timezone: 'America/Lima' });
    console.log(`[cron] Programado OK: ${expr} (America/Lima) — enabled=${cfg.enabled}`);
  } catch (err) {
    console.warn('[cron] node-cron no disponible:', err.message);
  }
}

function scheduleRecordatorios24h() {
  try {
    const nodeCron = require('node-cron');
    const rec24 = require('./lib/recordatorio24h');
    if (_cronRec24Task) { _cronRec24Task.stop(); _cronRec24Task = null; }
    if (_detenido) return;
    if (rec24.envInterruptor() === false) { console.log('[rec24] Desactivado por RECORDATORIO_24H_ENABLED'); return; }
    _cronRec24Task = nodeCron.schedule(rec24.REC24_CRON, () => {
      rec24.ejecutarCronRecordatorios24h().catch(e => console.error('[rec24]', e.message));
    }, { timezone: 'America/Lima' });
    console.log(`[rec24] Programado: ${rec24.REC24_CRON} (America/Lima)`);
  } catch (err) {
    console.warn('[rec24] node-cron no disponible:', err.message);
  }
}

async function iniciarCrons() {
  _detenido = false;
  await scheduleCron();
  scheduleRecordatorios24h();
}

function detenerCrons() {
  _detenido = true;
  try { if (_cronTask) { _cronTask.stop(); _cronTask = null; } } catch (_) {}
  try { if (_cronRec24Task) { _cronRec24Task.stop(); _cronRec24Task = null; } } catch (_) {}
}

module.exports = { iniciarCrons, detenerCrons, scheduleCron };
