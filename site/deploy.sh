#!/bin/bash
# Ejecutar desde la RAÍZ del repo git (carpeta que contiene site/)
#
# Deploy normal (pull + npm + limpiar workers):
#   cd ~/public_html && bash site/deploy.sh
#
# Deploy + reinicio automático en cPanel:
#   cd ~/public_html && bash site/deploy.sh --restart
#
# Solo limpiar workers (sin pull):
#   bash site/scripts/cpanel-clean-workers.sh -f

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --restart) DO_RESTART=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg (usa --restart o --help)" >&2
      exit 1
      ;;
  esac
done

echo "==> Repo: $ROOT"
git pull

cd site
npm install --omit=dev

echo ""
echo "==> Versión desplegada:"
cat public/DEPLOY_VERSION.txt
echo ""

echo "==> Limpiando workers lsnode (site + crm si existe)..."
bash scripts/cpanel-clean-workers.sh -f

if [ "$DO_RESTART" -eq 1 ]; then
  echo ""
  bash scripts/cpanel-restart-app.sh
else
  echo ""
  echo "==> Código actualizado y workers limpiados."
  echo "    Para reiniciar la app Node desde SSH (desde la raíz del repo):"
  echo "      bash site/scripts/cpanel-restart-app.sh"
  echo "    O en cPanel → Setup Node.js App → START (si estaba detenida) o Restart una vez."
  echo "==> Verifica: https://vhm.com.pe/site/api/deploy-info"
fi
