// NO usar PM2 en cPanel compartido si ya tienes "Setup Node.js App".
// Passenger (cPanel) ya gestiona los procesos Node.
// Si ejecutas pm2 start con este archivo ADEMÁS de cPanel, duplicarás procesos.
module.exports = {
  apps: [
    {
      name: 'vhm-libro-reclamaciones',
      script: 'app.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '384M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
