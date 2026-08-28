#!/bin/bash
# Ejecutar desde la RAÍZ del repo git (carpeta que contiene site/)
# Ejemplo: cd ~/repositorio/vhm && bash site/deploy.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Repo: $ROOT"
git fetch origin main
git reset --hard origin/main

if git lfs version >/dev/null 2>&1; then
  echo "==> Git LFS: descargando media/*.mp4"
  git lfs install
  git lfs pull origin main
else
  echo "==> AVISO: git-lfs no está instalado en el servidor."
  echo "    Sin LFS, media/tribu-hero.mp4 queda como puntero (~135 bytes) y el video no reproduce."
  echo "    Instala Git LFS o sube media/tribu-hero.mp4 manualmente (~1.3 GB)."
fi

HERO="$ROOT/media/tribu-hero.mp4"
if [ -f "$HERO" ] && [ "$(wc -c < "$HERO")" -lt 1000000 ]; then
  echo "==> ERROR: $HERO parece puntero Git LFS, no el MP4 real."
  echo "    Ejecuta: git lfs pull   o sube el archivo por FTP/cPanel File Manager."
  exit 1
fi

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
