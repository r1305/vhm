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
