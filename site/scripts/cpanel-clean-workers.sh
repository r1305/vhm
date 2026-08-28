#!/bin/bash
# Limpia workers lsnode huérfanos de site/ (y crm/ si existe) en cPanel/Passenger.
# Uso: bash site/scripts/cpanel-clean-workers.sh [opciones]
#
# Opciones:
#   -d, --dry-run   Solo muestra qué procesos se matarían
#   -v, --verbose   Muestra detalle de cada proceso
#   -f, --force     Usa SIGKILL (-9) si SIGTERM no bastó
#   --site-only     Solo limpia la app site
#   --crm-only      Solo limpia la app crm
#   -h, --help      Ayuda
#
# Variables opcionales:
#   VHM_SITE_DIR       Ruta absoluta a site/ (default: detectada desde este script)
#   VHM_CRM_DIR        Ruta absoluta a crm/ (default: hermana de site/)
#   VHM_LSUSER         Usuario cPanel (default: $USER)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="${VHM_SITE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REPO_ROOT="$(cd "$SITE_DIR/.." && pwd)"
CRM_DIR="${VHM_CRM_DIR:-$REPO_ROOT/crm}"
OPENWA_DIR="${VHM_CRM_DIR:-$REPO_ROOT/openwa}"
LSUSER="${VHM_LSUSER:-${USER:-}}"

DRY_RUN=0
VERBOSE=0
FORCE=0
CLEAN_SITE=1
CLEAN_CRM=1
CLEAN_OPENWA=1

usage() {
  sed -n '2,14p' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dry-run) DRY_RUN=1 ;;
    -v|--verbose) VERBOSE=1 ;;
    -f|--force) FORCE=1 ;;
    --site-only) CLEAN_SITE=0 ;;
    --crm-only) CLEAN_CRM=0 ;;
    --openwa-only) CLEAN_OPENWA=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

list_matching() {
  local pattern="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -af "$pattern" 2>/dev/null || true
  else
    ps aux | grep -F "$pattern" | grep -v grep || true
  fi
}

collect_pids() {
  local pattern="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "$pattern" 2>/dev/null || true
  else
    ps aux | grep -F "$pattern" | grep -v grep | awk '{print $2}' || true
  fi
}

kill_pattern() {
  local label="$1"
  local dir="$2"
  local pattern="lsnode:${dir}/"

  echo "==> $label: $pattern"

  local lines
  lines="$(list_matching "$pattern")"
  if [ -z "$lines" ]; then
    echo "    (sin procesos lsnode)"
    return 0
  fi

  if [ "$VERBOSE" -eq 1 ] || [ "$DRY_RUN" -eq 1 ]; then
    echo "$lines" | sed 's/^/    /'
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    [dry-run] no se enviaron señales"
    return 0
  fi

  local pids
  pids="$(collect_pids "$pattern")"
  if [ -z "$pids" ]; then
    echo "    (sin PIDs)"
    return 0
  fi

  echo "$pids" | while read -r pid; do
    [ -n "$pid" ] || continue
    kill -15 "$pid" 2>/dev/null || true
  done

  sleep 2

  pids="$(collect_pids "$pattern")"
  if [ -n "$pids" ] && [ "$FORCE" -eq 1 ]; then
    echo "    SIGTERM no bastó; enviando SIGKILL..."
    echo "$pids" | while read -r pid; do
      [ -n "$pid" ] || continue
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 1
  fi

  pids="$(collect_pids "$pattern")"
  if [ -n "$pids" ]; then
    echo "    ADVERTENCIA: aún quedan procesos:" >&2
    list_matching "$pattern" | sed 's/^/    /' >&2
    return 1
  fi

  echo "    OK"
}

kill_orphan_builds() {
  echo "==> npm/vite huérfanos (builds viejos)"
  local patterns=("npm run build" "vite build")
  local p
  for p in "${patterns[@]}"; do
    local lines
    lines="$(list_matching "$p")"
    [ -n "$lines" ] || continue
    if [ "$VERBOSE" -eq 1 ] || [ "$DRY_RUN" -eq 1 ]; then
      echo "    patrón: $p"
      echo "$lines" | sed 's/^/    /'
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      continue
    fi
    pkill -15 -f "$p" 2>/dev/null || true
  done
}

echo "==> Usuario: ${LSUSER:-?}"
echo "==> Site:   $SITE_DIR"
[ -d "$CRM_DIR" ] && echo "==> CRM:    $CRM_DIR" && echo "==> OPENWA:    $OPENWA_DIR"

status=0

if [ "$CLEAN_SITE" -eq 1 ]; then
  kill_pattern "site" "$SITE_DIR" || status=1
fi

if [ "$CLEAN_CRM" -eq 1 ] && [ -d "$CRM_DIR" ]; then
  kill_pattern "crm" "$CRM_DIR" || status=1
fi

if [ "$CLEAN_OPENWA" -eq 1 ] && [ -d "$OPENWA_DIR" ]; then
  kill_pattern "crm" "$OPENWA_DIR" || status=1
fi

kill_orphan_builds

echo ""
echo "==> lsnode restantes del usuario:"
if [ -n "$LSUSER" ]; then
  remaining="$(ps -u "$LSUSER" -o pid=,args= 2>/dev/null | grep lsnode | grep -v grep || true)"
else
  remaining="$(ps aux | grep lsnode | grep -v grep || true)"
fi
if [ -z "$remaining" ]; then
  echo "    (ninguno)"
else
  echo "$remaining" | sed 's/^/    /'
fi

exit "$status"
