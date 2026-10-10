const nodemailer = require('nodemailer');

let transporter = null;
let avisoSinSmtp = false;

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  };
}

function isMailerConfigured() {
  return !!smtpConfig();
}

function getTransporter() {
  if (transporter) return transporter;
  const cfg = smtpConfig();
  if (!cfg) return null;
  transporter = nodemailer.createTransport(cfg);
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    if (!avisoSinSmtp) {
      console.warn('[latribu/mail] SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS): no se envían correos');
      avisoSinSmtp = true;
    }
    return { skipped: true };
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || 'La Tribu VHM <noreply@vhm.com.pe>',
    to,
    subject: String(subject).slice(0, 200),
    text: text || '',
    html: html || undefined,
  });
  return { ok: true };
}

function closeMailer() {
  if (transporter) {
    try { transporter.close(); } catch (_) {}
    transporter = null;
  }
}
process.on('SIGTERM', closeMailer);
process.on('SIGINT', closeMailer);

function _resetForTests() {
  transporter = null;
  avisoSinSmtp = false;
}

module.exports = { sendMail, isMailerConfigured, closeMailer, _resetForTests };
