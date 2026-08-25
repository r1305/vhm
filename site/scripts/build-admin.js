/**
 * Compila admin-vue → public/admin cuando el código fuente cambió.
 * Se ejecuta al arrancar app.js y en postinstall (npm install).
 * Desactivar: ADMIN_SKIP_BUILD=1 en .env
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN_VUE = path.join(ROOT, 'admin-vue');
const OUT_INDEX = path.join(ROOT, 'public', 'admin', 'index.html');
const SRC_DIR = path.join(ADMIN_VUE, 'src');

function newestMtime(dir) {
  let max = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else max = Math.max(max, fs.statSync(p).mtimeMs);
    }
  }
  return max;
}

function needsBuild() {
  if (!fs.existsSync(SRC_DIR)) return false;
  if (!fs.existsSync(OUT_INDEX)) return true;
  const outTime = fs.statSync(OUT_INDEX).mtimeMs;
  const triggers = [
    path.join(ADMIN_VUE, 'package.json'),
    path.join(ADMIN_VUE, 'package-lock.json'),
    path.join(ADMIN_VUE, 'vite.config.js'),
    path.join(ADMIN_VUE, 'index.html'),
    SRC_DIR,
  ];
  for (const t of triggers) {
    if (!fs.existsSync(t)) continue;
    if (fs.statSync(t).isDirectory()) {
      if (newestMtime(t) > outTime) return true;
    } else if (fs.statSync(t).mtimeMs > outTime) {
      return true;
    }
  }
  return false;
}

function npmInAdmin(args, label) {
  const result = spawnSync('npm', args, {
    cwd: ADMIN_VUE,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: label === 'install' ? 'development' : process.env.NODE_ENV,
    },
  });
  if (result.status !== 0) {
    console.error(`[admin] ${label} falló (código ${result.status})`);
    return false;
  }
  return true;
}

function run() {
  if (process.env.ADMIN_SKIP_BUILD === '1') {
    console.log('[admin] compilación automática desactivada (ADMIN_SKIP_BUILD=1)');
    return;
  }
  if (!fs.existsSync(ADMIN_VUE)) {
    console.log('[admin] admin-vue no encontrado, se omite build');
    return;
  }
  if (!needsBuild()) {
    console.log('[admin] build al día, sin cambios en admin-vue');
    return;
  }

  console.log('[admin] compilando panel admin (admin-vue → public/admin)...');

  const nodeModules = path.join(ADMIN_VUE, 'node_modules', 'vite');
  if (!fs.existsSync(nodeModules)) {
    if (!npmInAdmin(['install', '--include=dev'], 'npm install admin-vue')) {
      return;
    }
  }

  const ok = npmInAdmin(['run', 'build'], 'vite build');
  if (ok) console.log('[admin] build completado');
}

module.exports = { run, needsBuild };

if (require.main === module) run();
