const app = require('./src/index');

if (typeof(PhusionPassenger) !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
}

// En cPanel, Passenger maneja el puerto automáticamente
const PORT = typeof(PhusionPassenger) !== 'undefined' ? 'passenger' : (process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log('Aplicación iniciada');
});
