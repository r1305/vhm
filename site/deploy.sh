#!/bin/bash
# Deploy completo VHM (site + crm + openwa) en cPanel.
#
# Comando único (desde la raíz del repo, carpeta padre de site/):
#   cd ~/public_html && bash site/deploy.sh --restart
#
# Solo pull + npm + limpiar workers:
#   cd ~/public_html && bash site/deploy.sh

set -e

SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SITE_DIR/.." && pwd)"
cd "$ROOT"

DO_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --restart) DO_RESTART=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg (usa --restart o --help)" >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$ROOT/.git" ] && [ ! -f "$ROOT/.git" ]; then
  echo "ERROR: no hay repo git en $ROOT" >&2
  echo "       Entra a la carpeta padre de site/ (ej. cd ~/public_html) e intenta de nuevo." >&2
  exit 1
fi

echo "==> Repo: $ROOT"
git fetch origin main
git reset --hard origin/main

activate_nodevenv() {
  local app="$1"
  local venv="${VHM_NODE_VENV:-$HOME/nodevenv/public_html/$app/22/bin/activate}"
  if [ -f "$venv" ]; then
    # shellcheck disable=SC1090
    source "$venv"
    echo "    venv: $venv"
  fi
}

npm_install_app() {
  local app="$1"
  local dir="$ROOT/$app"
  if [ ! -f "$dir/package.json" ]; then
    echo "==> Omitiendo npm ($app): sin package.json"
    return 0
  fi
  echo "==> npm install ($app)..."
  activate_nodevenv "$app"
  (cd "$dir" && npm install --omit=dev)
}

for app in site crm openwa; do
  npm_install_app "$app"
done

if [ -f site/public/DEPLOY_VERSION.txt ]; then
  echo ""
  echo "==> Versión site:"
  cat site/public/DEPLOY_VERSION.txt
fi

echo ""
echo "==> Limpiando workers lsnode (site + crm + openwa)..."
bash site/scripts/cpanel-clean-workers.sh -f

if [ "$DO_RESTART" -eq 1 ]; then
  echo ""
  bash site/scripts/cpanel-restart-apps.sh
else
  echo ""
  echo "==> Código actualizado y workers limpiados."
  echo "    Para reiniciar site, crm y openwa:"
  echo "      bash site/scripts/cpanel-restart-apps.sh"
fi
