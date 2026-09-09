#!/bin/bash
# Despliegue unificado VHM + OpenWA en cPanel.
# Ejecutar desde cualquier lugar:
#   bash ~/redeploy.sh
#   bash ~/public_html/redeploy.sh
#
# Hace pull + npm de vhm (site, crm, luma) y openwa, luego reinicia las apps.
#
# Variables opcionales:
#   VHM_ROOT            ruta del repo vhm (default: ~/public_html)
#   VHM_OPENWA_DIR      ruta del repo openwa (default: $VHM_ROOT/openwa)
#   VHM_OPENWA_BRANCH   rama de openwa (default: master)
#   --no-restart        solo pull + npm, sin reiniciar apps

set -e

VHM_ROOT="${VHM_ROOT:-$HOME/public_html}"
OPENWA_DIR="${VHM_OPENWA_DIR:-$VHM_ROOT/openwa}"
OPENWA_BRANCH="${VHM_OPENWA_BRANCH:-master}"
DO_RESTART=1

for arg in "$@"; do
  case "$arg" in
    --no-restart) DO_RESTART=0 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg (usa --no-restart o --help)" >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$VHM_ROOT/site" ]; then
  echo "ERROR: no se encuentra site/ en $VHM_ROOT" >&2
  exit 1
fi

activate_nodevenv() {
  local app="$1"
  local venv="${VHM_NODE_VENV:-$HOME/nodevenv/public_html/$app/22/bin/activate}"
  if [ -f "$venv" ]; then
    # shellcheck disable=SC1090
    source "$venv"
    echo "    venv: $venv"
  fi
}

echo "========================================"
echo "  Redeploy VHM + OpenWA"
echo "========================================"

echo ""
echo "==> [1/3] VHM (site + crm + luma)..."
(cd "$VHM_ROOT" && bash deploy.sh)

echo ""
echo "==> [2/3] OpenWA..."
if [ -d "$OPENWA_DIR/.git" ] || [ -f "$OPENWA_DIR/.git" ]; then
  cd "$OPENWA_DIR"
  echo "    Repo: $OPENWA_DIR (branch $OPENWA_BRANCH)"
  git fetch origin "$OPENWA_BRANCH"
  git reset --hard "origin/$OPENWA_BRANCH"

  if [ -f package.json ]; then
    echo "==> npm install (openwa)..."
    activate_nodevenv "openwa"
    npm install --omit=dev
  fi
else
  echo "WARN: OpenWA no es un repo git en $OPENWA_DIR — omitido."
fi

if [ "$DO_RESTART" -eq 1 ]; then
  echo ""
  echo "==> [3/3] Reiniciando apps Node (site, crm, luma, openwa)..."
  bash "$VHM_ROOT/site/scripts/cpanel-restart-apps.sh" site crm luma openwa
else
  echo ""
  echo "==> Código actualizado (sin reinicio)."
  echo "    Para reiniciar:"
  echo "      bash $VHM_ROOT/site/scripts/cpanel-restart-apps.sh site crm luma openwa"
fi

echo ""
echo "==> Listo."
