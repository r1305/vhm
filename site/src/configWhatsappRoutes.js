const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN')) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT numero, mensaje, activo, fecha_actualizacion FROM config_whatsapp WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) { res.status(500).json({ error: 'Error al obtener configuración de WhatsApp' }); }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const { numero, mensaje, activo } = req.body;
    if (activo && !numero)
      return res.status(400).json({ error: 'El número de WhatsApp es obligatorio para activar el botón' });
    if (numero && !/^\d+$/.test(numero))
      return res.status(400).json({ error: 'El número debe contener solo dígitos (sin +, espacios ni guiones)' });

    const [existing] = await pool.execute('SELECT id FROM config_whatsapp WHERE id = 1');
    if (existing.length > 0) {
      await pool.execute('UPDATE config_whatsapp SET numero=?, mensaje=?, activo=?, fecha_actualizacion=NOW() WHERE id=1',
        [numero || null, mensaje || null, activo ? 1 : 0]);
    } else {
      await pool.execute('INSERT INTO config_whatsapp (id, numero, mensaje, activo, fecha_actualizacion) VALUES (1,?,?,?,NOW())',
        [numero || null, mensaje || null, activo ? 1 : 0]);
    }
    res.json({ message: 'Configuración de WhatsApp guardada correctamente' });
  } catch (err) { res.status(500).json({ error: 'Error al guardar configuración de WhatsApp' }); }
});

module.exports = router;
