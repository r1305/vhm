const nodemailer = require('nodemailer');
const pool = require('./db');

async function getConfig() {
  const [rows] = await pool.execute('SELECT * FROM config_email WHERE id = 1');
  if (rows.length === 0) throw new Error('Configuración de email no encontrada');
  return rows[0];
}

async function enviarNotificacion(destinatario, numeroReclamo, respuesta) {
  const cfg = await getConfig();

  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure === 1,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }
  });

  return transporter.sendMail({
    from: `"${cfg.nombre_from}" <${cfg.email_from}>`,
    to: destinatario,
    subject: `Respuesta a su reclamo N° ${numeroReclamo}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#000;color:#f5f0eb;">
        <h2 style="color:#c8e6f0;">Respuesta a su Reclamo</h2>
        <p>Estimado(a) cliente,</p>
        <p>Le informamos que su reclamo <strong>N° ${numeroReclamo}</strong> ha sido atendido.</p>
        <div style="background:#111;border:1px solid #222;padding:15px;border-radius:6px;margin:15px 0;">
          <strong style="color:#c8e6f0;">Respuesta:</strong>
          <p style="margin-top:8px;">${respuesta}</p>
        </div>
        <p>Atentamente,<br>${cfg.nombre_from}</p>
      </div>
    `
  });
}

module.exports = { enviarNotificacion, getConfig };
