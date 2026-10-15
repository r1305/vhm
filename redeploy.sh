#!/bin/bash
# Redeploy VHM (app unificada) en cPanel: git + npm + reinicio Passenger.
#
# Uso (en el servidor):
#   bash ~/vhm/redeploy.sh
#   RAMA=otra-rama bash ~/vhm/redeploy.sh
#
# Variables opcionales:
#   RAMA       rama a desplegar (default: monorepo)
#   NODE_BIN   carpeta bin del Node de la app (default: /home/ssfdgwtm/nodevenv/vhm/22/bin)

set -euo pipefail

RAMA="${RAMA:-monorepo}"
NODE_BIN="${NODE_BIN:-/home/ssfdgwtm/nodevenv/vhm/22/bin}"

cd "$(dirname "${BASH_SOURCE[0]}")"
RAIZ="$(pwd)"

fallo() {
  echo "ERROR: $1" >&2
  exit 1
}

echo "========================================"
echo "  Redeploy VHM"
echo "  Repo: $RAIZ"
echo "  Rama: $RAMA"
echo "========================================"

echo ""
echo "==> [1/4] Actualizando código (solo fast-forward)..."
git fetch origin || fallo "git fetch falló. Revisa red/credenciales; no se tocó nada."
git checkout "$RAMA" || fallo "git checkout $RAMA falló (¿cambios locales sin commitear?). Resuélvelo a mano."
git pull --ff-only origin "$RAMA" || fallo "git pull --ff-only falló (historia divergida o cambios locales). Resuélvelo a mano; el script no hace reset ni force."

echo ""
echo "==> [2/4] Instalando dependencias con Node de la app..."
[ -x "$NODE_BIN/node" ] || fallo "no existe $NODE_BIN/node (revisa NODE_BIN)."
export PATH="$NODE_BIN:$PATH"
echo "    node $(node -v) / npm $(npm -v)"
npm install --omit=dev

echo ""
echo "==> [3/4] Verificando sintaxis de app.js..."
node --check app.js || fallo "node --check app.js falló; NO se reinicia la app."

echo ""
echo "==> [4/4] Reiniciando app (Passenger: tmp/restart.txt)..."
mkdir -p tmp
touch tmp/restart.txt

echo ""
echo "==> Listo. Rama $RAMA en $(git rev-parse --short HEAD)."
