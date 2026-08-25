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
echo "==> Listo. Ahora haz RESTART en cPanel → Setup Node.js App"
echo "==> Verifica: https://TU-DOMINIO/site/api/deploy-info"
