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
    console.log('[crm/mail] SMTP no configurado — omitido:', subject, '->', to);
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

/* ── WhatsApp via Twilio ──────────────────────────────────────
   Variables requeridas en .env:
     WA_ACCOUNT_SID=ACxxx
     WA_AUTH_TOKEN=xxx
     WA_FROM=whatsapp:+14155238886   (sandbox Twilio o número aprobado)
*/
async function sendWhatsApp({ to, message }) {
  const sid   = process.env.WA_ACCOUNT_SID;
  const token = process.env.WA_AUTH_TOKEN;
  const from  = process.env.WA_FROM;

  if (!sid || !token || !from) {
    console.log('[crm/whatsapp] No configurado — omitido:', to);
    return { skipped: true };
  }

  // Normalizar número: asegurar prefijo whatsapp:+
  const toNorm = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace(/\D/g, '')}`;

  const body = new URLSearchParams({ From: from, To: toNorm, Body: message });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      },
      body: body.toString(),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Error Twilio');
  return { ok: true, sid: data.sid };
}

// Recordatorio de cita — email + WhatsApp + SMS según canal
async function sendRecordatorioCita(paciente, cita, terapeuta, canal = 'email') {
  const fecha = new Date(cita.fecha).toLocaleDateString('es-PE',
    { weekday: 'long', day: '2-digit', month: 'long' });
  const hora = String(cita.hora_inicio).slice(0, 5);

  const mensaje = `Hola ${paciente.nombre}, te recordamos tu cita el ${fecha} a las ${hora} con ${terapeuta.nombre} ${terapeuta.apellido} (${cita.modalidad}). VHM Centro de Psicología.`;

  const html = `
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
      <p>Si necesitas cancelar o reprogramar contáctanos con anticipación.</p>
      <p style="color:#64748b;font-size:12px">VHM Centro de Psicología</p>
    </div>`;

  const results = {};

  if ((canal === 'email' || canal === 'ambos') && paciente.email) {
    results.email = await sendMail({
      to: paciente.email,
      subject: `Recordatorio de tu cita — ${fecha}`,
      html,
    }).catch(e => ({ error: e.message }));
  }

  if ((canal === 'whatsapp' || canal === 'ambos') && paciente.telefono) {
    results.whatsapp = await sendWhatsApp({
      to: paciente.telefono,
      message: mensaje,
    }).catch(e => ({ error: e.message }));
  }

  return results;
}

async function sendFollowUp(paciente) {
  return sendMail({
    to: paciente.email,
    subject: '¿Cómo has estado? — VHM',
    html: `
      <div style="font-family:sans-serif;max-width:520px;color:#1e293b">
        <h2 style="color:#7c3aed">Hola ${paciente.nombre} 👋</h2>
        <p>Han pasado unos días desde tu última sesión y queríamos saber cómo te has sentido.</p>
        <p>Si sientes que necesitas retomar el proceso, estamos aquí para ti.</p>
        <p style="color:#64748b;font-size:12px">Con cariño — Equipo VHM</p>
      </div>`,
  });
}

module.exports = { sendMail, sendWhatsApp, sendRecordatorioCita, sendFollowUp };
