#!/bin/bash
# Stop → limpia lsnode → Start de apps Node en cPanel (site, crm, openwa).
# Uso: bash site/scripts/cpanel-restart-apps.sh [site|crm|openwa ...]
#
# Sin argumentos reinicia las tres (si existen en disco y en cloudlinux-selector).
#
# Variables opcionales:
#   VHM_CPANEL_USER     usuario cPanel (default: $USER)
#   VHM_NODE_APPS       lista de apps (default: "site crm openwa")

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CPUSER="${VHM_CPANEL_USER:-${USER:-}}"

if [ -z "$CPUSER" ]; then
  echo "ERROR: no se detectó usuario (define VHM_CPANEL_USER)." >&2
  exit 1
fi

if ! command -v cloudlinux-selector >/dev/null 2>&1; then
  echo "ERROR: cloudlinux-selector no está disponible en este servidor." >&2
  echo "       En cPanel: STOP cada app → bash site/scripts/cpanel-clean-workers.sh -f → START" >&2
  exit 1
fi

app_root_for_dir() {
  local dir="$1"
  if [[ "$dir" == "$HOME/"* ]]; then
    echo "${dir#$HOME/}"
  else
    basename "$dir"
  fi
}

selector() {
  local action="$1"
  local app_root="$2"
  app_root="${app_root#/}"
  cloudlinux-selector "$action" --json --interpreter nodejs --user "$CPUSER" --app-root "$app_root"
}

declare -a REQUESTED=()
if [ $# -gt 0 ]; then
  REQUESTED=("$@")
else
  IFS=' ' read -r -a REQUESTED <<< "${VHM_NODE_APPS:-site crm openwa}"
fi

declare -a APP_DIRS=()
declare -a APP_ROOTS=()
declare -a APP_NAMES=()

for name in "${REQUESTED[@]}"; do
  dir="$REPO_ROOT/$name"
  if [ ! -d "$dir" ]; then
    echo "==> Omitiendo $name (no existe $dir)"
    continue
  fi
  root="$(app_root_for_dir "$dir")"
  APP_NAMES+=("$name")
  APP_DIRS+=("$dir")
  APP_ROOTS+=("$root")
done

if [ ${#APP_NAMES[@]} -eq 0 ]; then
  echo "ERROR: ninguna app encontrada para reiniciar." >&2
  exit 1
fi

echo "==> Reinicio Node.js (cPanel) — usuario: $CPUSER"
for i in "${!APP_NAMES[@]}"; do
  echo "    - ${APP_NAMES[$i]} → ${APP_ROOTS[$i]}"
done

echo ""
echo "==> Stop..."
for root in "${APP_ROOTS[@]}"; do
  selector stop "$root" || true
done

echo ""
# Solo limpiar workers de las apps que se van a reiniciar
CLEAN_FLAGS=()
for name in "${APP_NAMES[@]}"; do
  CLEAN_FLAGS+=("--${name}-only")
done
bash "$SCRIPT_DIR/cpanel-clean-workers.sh" -f "${CLEAN_FLAGS[@]}"

echo ""
echo "==> Start..."
for i in "${!APP_NAMES[@]}"; do
  echo "    ${APP_NAMES[$i]}..."
  selector start "${APP_ROOTS[$i]}"
done

echo ""
echo "==> Listo."
echo "    Site:   https://vhm.com.pe/site/api/deploy-info"
echo "    CRM:    https://vhm.com.pe/crm/login"
echo "    OpenWA: https://vhm.com.pe/openwa"
