const { Router } = require('express');
const pool = require('./db');
const { authMiddleware } = require('./auth');

const router = Router();

// Ruta pública - obtener testimonios activos
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, autor, texto, foto_url FROM testimonios WHERE activo = 1 ORDER BY orden ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Ruta admin - obtener todos los testimonios
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const [rows] = await pool.execute('SELECT * FROM testimonios ORDER BY orden ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// Crear testimonio
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const { autor, texto, foto_url, orden, activo } = req.body;
    if (!autor || !texto) return res.status(400).json({ error: 'Autor y texto son obligatorios' });

    const [result] = await pool.execute(
      'INSERT INTO testimonios (autor, texto, foto_url, orden, activo) VALUES (?, ?, ?, ?, ?)',
      [autor, texto, foto_url || null, orden || 1, activo ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, message: 'Testimonio creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear testimonio' });
  }
});

// Actualizar testimonio
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const { autor, texto, foto_url, orden, activo } = req.body;
    if (!autor || !texto) return res.status(400).json({ error: 'Autor y texto son obligatorios' });

    const [result] = await pool.execute(
      'UPDATE testimonios SET autor = ?, texto = ?, foto_url = ?, orden = ?, activo = ? WHERE id = ?',
      [autor, texto, foto_url || null, orden || 1, activo ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });
    res.json({ message: 'Testimonio actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar testimonio' });
  }
});

// Eliminar testimonio
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Acceso restringido' });
    const [result] = await pool.execute('DELETE FROM testimonios WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Testimonio no encontrado' });
    res.json({ message: 'Testimonio eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar testimonio' });
  }
});

module.exports = router;
