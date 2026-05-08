const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'bh8980.banahosting.com',
  port: 465,
  secure: true,
  auth: {
    user: 'noreply@tudominio.com',  // CAMBIAR por tu email real
    pass: 'tu_password_email'        // CAMBIAR por tu password real
  }
});

async function enviarNotificacion(destinatario, numeroReclamo, respuesta) {
  const mailOptions = {
    from: '"Libro de Reclamaciones" <noreply@tudominio.com>',
    to: destinatario,
    subject: `Respuesta a su reclamo N° ${numeroReclamo}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#c62828;">Respuesta a su Reclamo</h2>
        <p>Estimado(a) cliente,</p>
        <p>Le informamos que su reclamo <strong>N° ${numeroReclamo}</strong> ha sido atendido.</p>
        <div style="background:#f5f5f5;padding:15px;border-radius:6px;margin:15px 0;">
          <strong>Respuesta:</strong>
          <p>${respuesta}</p>
        </div>
        <p>Atentamente,<br>Equipo de Atención al Cliente</p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

module.exports = { enviarNotificacion };
