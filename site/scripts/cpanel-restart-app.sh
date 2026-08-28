#!/bin/bash
# Stop → limpia lsnode → Start/restart de la app Node site en cPanel (cloudlinux-selector).
# Uso: bash site/scripts/cpanel-restart-app.sh
#
# Variables opcionales:
#   VHM_NODE_APP_ROOT   app-root de cPanel (ej. public_html/site). Default: site/ relativo a $HOME
#   VHM_CPANEL_USER     usuario cPanel (default: $USER)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CPUSER="${VHM_CPANEL_USER:-${USER:-}}"

if [ -z "$CPUSER" ]; then
  echo "ERROR: no se detectó usuario (define VHM_CPANEL_USER)." >&2
  exit 1
fi

if ! command -v cloudlinux-selector >/dev/null 2>&1; then
  echo "ERROR: cloudlinux-selector no está disponible en este servidor." >&2
  echo "       En cPanel: STOP → bash site/scripts/cpanel-clean-workers.sh -f → START" >&2
  exit 1
fi

if [ -n "${VHM_NODE_APP_ROOT:-}" ]; then
  APP_ROOT="$VHM_NODE_APP_ROOT"
elif [[ "$SITE_DIR" == "$HOME/"* ]]; then
  APP_ROOT="${SITE_DIR#$HOME/}"
else
  APP_ROOT="$SITE_DIR"
fi

APP_ROOT="${APP_ROOT#/}"

echo "==> Reinicio Node.js (cPanel)"
echo "    usuario:  $CPUSER"
echo "    app-root: $APP_ROOT"

echo "==> Stop..."
cloudlinux-selector stop --json --interpreter nodejs --user "$CPUSER" --app-root "$APP_ROOT" || true

echo "==> Limpiando workers..."
bash "$SCRIPT_DIR/cpanel-clean-workers.sh" --site-only -f

echo "==> Start..."
cloudlinux-selector start --json --interpreter nodejs --user "$CPUSER" --app-root "$APP_ROOT"

echo "==> Listo. Verifica: https://vhm.com.pe/site/api/deploy-info"
