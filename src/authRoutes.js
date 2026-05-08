const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { JWT_SECRET } = require('./auth');

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const [rows] = await pool.execute('SELECT * FROM usuarios WHERE username = ? AND activo = 1', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el login' });
  }
});

module.exports = router;
