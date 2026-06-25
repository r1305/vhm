const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { signToken, auth } = require('../lib/auth');

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  try {
    const [[user]] = await pool.execute(
      'SELECT id, nombre, apellido, username, email, password, rol, especialidad FROM terapeutas WHERE username = ? AND activo = 1 LIMIT 1',
      [String(username).trim()]
    );
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const { password: _, ...safe } = user;
    res.json({ token: signToken({ id: user.id, rol: user.rol, nombre: user.nombre }), user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const [[user]] = await pool.execute(
      'SELECT id, nombre, apellido, username, email, rol, especialidad, bio FROM terapeutas WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
