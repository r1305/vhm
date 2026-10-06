/**
 * Helpers del funnel de conversión (zona America/Lima vía lib/db.js en SQL).
 */
const crypto = require('crypto');

const TRIAL_DAYS_DEFAULT = 7;

function splitDisplayName(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return { nombre: 'Miembro', apellido: 'La Tribu' };
  const parts = s.split(' ');
  if (parts.length === 1) return { nombre: parts[0], apellido: '—' };
  return { nombre: parts[0], apellido: parts.slice(1).join(' ') };
}

function trialDaysFromEnv() {
  const n = parseInt(process.env.TRIBU_TRIAL_DIAS, 10);
  return Number.isFinite(n) && n > 0 ? n : TRIAL_DAYS_DEFAULT;
}

/** Fecha del primer cobro (fin de prueba + 1 día calendario en lógica de renovación). */
function formatRenewalDateLima(days) {
  const d = new Date();
  d.setDate(d.getDate() + (days || trialDaysFromEnv()));
  return d.toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function newTrialChargeRef() {
  return `trial-${crypto.randomUUID()}`;
}

module.exports = {
  splitDisplayName,
  trialDaysFromEnv,
  formatRenewalDateLima,
  newTrialChargeRef,
  TRIAL_DAYS_DEFAULT,
};
