const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const RAIZ = path.join(__dirname, '..');
const COMUNES = new Set(['NODE_ENV', 'PORT', 'TZ']);

let estricto = false;
let leerArchivos = true;
const archivos = new Map();

function configurar(opciones = {}) {
  if (opciones.estricto !== undefined) estricto = Boolean(opciones.estricto);
  if (opciones.archivos !== undefined) leerArchivos = Boolean(opciones.archivos);
  archivos.clear();
}

function leer(archivo) {
  if (!leerArchivos) return {};
  if (!archivos.has(archivo)) {
    archivos.set(archivo, fs.existsSync(archivo)
      ? createRequire(archivo)('dotenv').parse(fs.readFileSync(archivo))
      : {});
  }
  return archivos.get(archivo);
}

const definido = (v) => v != null && v !== '';

// Modo estricto (app unificada): <PREFIJO>CLAVE en process.env, luego en el .env raíz y, para
// desarrollo local, en el .env propio de la app; nunca la clave sin prefijo de process.env.
// Modo compatible (app suelta, por defecto): <PREFIJO>CLAVE y luego CLAVE en process.env.
function crearEnv(prefijo, dirApp) {
  const propio = path.join(dirApp, '.env');
  const raiz = path.join(RAIZ, '.env');
  const ajustes = {};

  function env(clave, porDefecto) {
    if (Object.prototype.hasOwnProperty.call(ajustes, clave)) return ajustes[clave];
    const global = COMUNES.has(clave) ? clave : prefijo + clave;
    const candidatos = estricto
      ? [process.env[global], leer(raiz)[global], leer(propio)[global], leer(propio)[clave]]
      : [process.env[global], process.env[clave]];
    const v = candidatos.find(definido);
    return v === undefined ? porDefecto : v;
  }

  env.set = (clave, valor) => { ajustes[clave] = valor; };
  env.prefijo = prefijo;
  return env;
}

// Solo NODE_ENV, PORT y TZ pasan a process.env (las usan express y librerías de terceros).
function aplicarComunes(dirsApps = []) {
  if (!leerArchivos) return;
  const fuentes = [path.join(RAIZ, '.env'), ...dirsApps.map((d) => path.join(d, '.env'))].map(leer);
  for (const clave of COMUNES) {
    if (definido(process.env[clave])) continue;
    const v = fuentes.map((f) => f[clave]).find(definido);
    if (v !== undefined) process.env[clave] = v;
  }
}

module.exports = { crearEnv, configurar, aplicarComunes, COMUNES };
