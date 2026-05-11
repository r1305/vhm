const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();
router.use(authMiddleware);

function soloSuperAdmin(req, res, next) {
  if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido al Super Admin' });
  next();
}

// Obtener configuración
router.get('/', soloSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, smtp_host, smtp_port, smtp_secure, smtp_user, email_from, nombre_from, fecha_actualizacion FROM config_email WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// Guardar configuración
router.put('/', soloSuperAdmin, async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, email_from, nombre_from } = req.body;
    if (!smtp_host || !smtp_port || !smtp_user || !email_from || !nombre_from) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios excepto la contraseña' });
    }

    const campos = ['smtp_host = ?', 'smtp_port = ?', 'smtp_secure = ?', 'smtp_user = ?', 'email_from = ?', 'nombre_from = ?'];
    const valores = [smtp_host, smtp_port, smtp_secure ? 1 : 0, smtp_user, email_from, nombre_from];

    if (smtp_pass) { campos.push('smtp_pass = ?'); valores.push(smtp_pass); }

    await pool.execute(`UPDATE config_email SET ${campos.join(', ')} WHERE id = 1`, valores);
    res.json({ message: 'Configuración guardada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// Probar configuración
router.post('/test', soloSuperAdmin, async (req, res) => {
  try {
    const { email, mensaje } = req.body;
    const { enviarNotificacion } = require('./mailer');
    
    let emailDestino, mensajePrueba;
    
    if (email && mensaje) {
      // Si se proporcionan email y mensaje personalizados
      emailDestino = email;
      mensajePrueba = mensaje;
    } else {
      // Comportamiento por defecto
      const user = await pool.execute('SELECT email FROM usuarios WHERE id = ?', [req.user.id]);
      emailDestino = user[0][0]?.email;
      if (!emailDestino) return res.status(400).json({ error: 'No se encontró email del usuario' });
      mensajePrueba = 'Este es un correo de prueba de configuración SMTP.';
    }
    
    await enviarNotificacion(emailDestino, 'TEST-0000', mensajePrueba);
    res.json({ message: `Correo de prueba enviado a ${emailDestino}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error al enviar prueba: ${err.message}` });
  }
});

module.exports = router;
