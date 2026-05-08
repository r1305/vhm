const path = require('path');
const express = require('express');
const cors = require('cors');
const reclamosRoutes = require('./routes');
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/consulta', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/consulta.html'));
});

app.get('/reclamo', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reclamo.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/reclamos', reclamosRoutes);
app.use('/api/usuarios', usuariosRoutes);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
