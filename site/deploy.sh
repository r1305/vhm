#!/bin/bash
# Ejecutar desde la RAÍZ del repo git (carpeta que contiene site/)
# Ejemplo: cd ~/repositorio/vhm && bash site/deploy.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Repo: $ROOT"
git fetch origin main
git reset --hard origin/main

cd site
npm install --omit=dev

echo ""
echo "==> Versión desplegada:"
cat public/DEPLOY_VERSION.txt
echo ""
echo "==> Listo. En cPanel → Setup Node.js App:"
echo "    1) STOP la app"
echo "    2) pkill -f 'lsnode:.../site/'  (si quedan workers viejos)"
echo "    3) START una sola vez"
echo "==> Verifica: https://TU-DOMINIO/site/api/deploy-info"
