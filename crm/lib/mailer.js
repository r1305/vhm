const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === '1',
    auth: { user, pass },
  });
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransport();
  if (!t) {
    console.log('[crm/mail] SMTP no configurado — mail omitido:', subject, '->', to);
    return { skipped: true };
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || 'VHM CRM <noreply@vhm.com.pe>',
    to,
    subject: String(subject).slice(0, 200),
    text: text || '',
    html: html || undefined,
  });
  return { ok: true };
}

// Recordatorio de cita
async function sendRecordatorioCita(paciente, cita, terapeuta) {
  const fecha = new Date(cita.fecha).toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long' });
  const hora  = cita.hora_inicio.slice(0, 5);
  return sendMail({
    to: paciente.email,
    subject: `Recordatorio de tu cita — ${fecha}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;color:#1e293b">
        <h2 style="color:#7c3aed">VHM — Recordatorio de cita</h2>
        <p>Hola <strong>${paciente.nombre}</strong>,</p>
        <p>Te recordamos tu cita programada:</p>
        <ul>
          <li><strong>Fecha:</strong> ${fecha}</li>
          <li><strong>Hora:</strong> ${hora}</li>
          <li><strong>Terapeuta:</strong> ${terapeuta.nombre} ${terapeuta.apellido}</li>
          <li><strong>Modalidad:</strong> ${cita.modalidad}</li>
        </ul>
        <p>Si necesitas cancelar o reprogramar, por favor contáctanos con anticipación.</p>
        <p style="color:#64748b;font-size:12px">VHM — Centro de Psicología</p>
      </div>`,
  });
}

// Follow-up post-ausencia
async function sendFollowUp(paciente) {
  return sendMail({
    to: paciente.email,
    subject: '¿Cómo has estado? — VHM',
    html: `
      <div style="font-family:sans-serif;max-width:520px;color:#1e293b">
        <h2 style="color:#7c3aed">Hola ${paciente.nombre} 👋</h2>
        <p>Han pasado unos días desde tu última sesión y queríamos saber cómo te has sentido.</p>
        <p>Si sientes que necesitas retomar el proceso o simplemente conversar, estamos aquí para ti.</p>
        <p>Puedes responder este correo o escribirnos directamente.</p>
        <p style="color:#64748b;font-size:12px">Con cariño — Equipo VHM</p>
      </div>`,
  });
}

module.exports = { sendMail, sendRecordatorioCita, sendFollowUp };
