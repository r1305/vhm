const path = require('path');
const express = require('express');
const cors = require('cors');
const reclamosRoutes = require('./routes');
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');
const configEmailRoutes = require('./configEmailRoutes');
const configPixelRoutes = require('./configPixelRoutes');
const configWhatsappRoutes = require('./configWhatsappRoutes');
const testimoniosRoutes = require('./testimoniosRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/consulta', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/consulta.html'));
});

app.get('/reclamo', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reclamo.html'));
});

// Ruta pública para obtener configuración del pixel
app.get('/api/pixel-config', async (req, res) => {
  try {
    const pool = require('./db');
    const [rows] = await pool.execute('SELECT pixel_id, activo FROM config_pixel WHERE id = 1 AND activo = 1');
    res.json(rows[0] || { pixel_id: null, activo: false });
  } catch (err) {
    console.error(err);
    res.json({ pixel_id: null, activo: false });
  }
});

// Ruta pública para obtener configuración de WhatsApp
app.get('/api/whatsapp-config', async (req, res) => {
  try {
    const pool = require('./db');
    const [rows] = await pool.execute('SELECT numero, mensaje, activo FROM config_whatsapp WHERE id = 1 AND activo = 1');
    res.json(rows[0] || { numero: null, mensaje: null, activo: false });
  } catch (err) {
    console.error(err);
    res.json({ numero: null, mensaje: null, activo: false });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/reclamos', reclamosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/config-email', configEmailRoutes);
app.use('/api/config-pixel', configPixelRoutes);
app.use('/api/config-whatsapp', configWhatsappRoutes);
app.use('/api/testimonios', testimoniosRoutes);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
