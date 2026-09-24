#!/bin/bash
# Redeploy completo VHM + OpenWA en cPanel.
# Flujo: listar procesos → stop apps → kill lsnodes → git pull + npm → start apps
#
# Uso:
#   bash ~/redeploy.sh
#   bash ~/public_html/redeploy.sh
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
CPUSER="${VHM_CPANEL_USER:-${USER:-}}"
DO_RESTART=1

for arg in "$@"; do
  case "$arg" in
    --no-restart) DO_RESTART=0 ;;
    -h|--help)
      sed -n '2,12p' "$0"
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

APPS=(site crm latribu luma)

activate_nodevenv() {
  local app="$1"
  local venv="${VHM_NODE_VENV:-$HOME/nodevenv/public_html/$app/22/bin/activate}"
  if [ -f "$venv" ]; then
    # shellcheck disable=SC1090
    source "$venv"
  fi
}

selector() {
  local action="$1"
  local app_root="$2"
  app_root="${app_root#/}"
  cloudlinux-selector "$action" --json --interpreter nodejs --user "$CPUSER" --app-root "$app_root" 2>/dev/null || true
}

app_root_for() {
  local dir="$VHM_ROOT/$1"
  if [[ "$dir" == "$HOME/"* ]]; then
    echo "${dir#$HOME/}"
  else
    basename "$dir"
  fi
}

echo "========================================"
echo "  Redeploy VHM + OpenWA"
echo "  Usuario: ${CPUSER:-?}"
echo "  Repo:    $VHM_ROOT"
echo "========================================"

# ── [1] Listar procesos lsnode actuales ──────────────────────────────────────
echo ""
echo "==> [1/5] Procesos lsnode actuales:"
if [ -n "$CPUSER" ]; then
  procs="$(ps -u "$CPUSER" -o pid=,args= 2>/dev/null | grep lsnode | grep -v grep || true)"
else
  procs="$(ps aux | grep lsnode | grep -v grep || true)"
fi
if [ -z "$procs" ]; then
  echo "    (ninguno)"
else
  echo "$procs" | sed 's/^/    /'
fi

# ── [2] Stop apps via cloudlinux-selector ────────────────────────────────────
if [ "$DO_RESTART" -eq 1 ] && command -v cloudlinux-selector >/dev/null 2>&1; then
  echo ""
  echo "==> [2/5] Deteniendo apps Node..."
  for app in "${APPS[@]}"; do
    dir="$VHM_ROOT/$app"
    [ -d "$dir" ] || continue
    root="$(app_root_for "$app")"
    echo "    stop: $app ($root)"
    selector stop "$root"
  done
  if [ -d "$OPENWA_DIR" ]; then
    root="$(app_root_for openwa)"
    echo "    stop: openwa ($root)"
    selector stop "$root"
  fi
else
  echo ""
  echo "==> [2/5] Stop omitido (--no-restart o cloudlinux-selector no disponible)"
fi

# ── [3] Matar todos los lsnodes ──────────────────────────────────────────────
echo ""
echo "==> [3/5] Matando todos los procesos lsnode..."
bash "$VHM_ROOT/site/scripts/cpanel-clean-workers.sh" -f

echo ""
echo "    lsnodes restantes tras limpieza:"
if [ -n "$CPUSER" ]; then
  remaining="$(ps -u "$CPUSER" -o pid=,args= 2>/dev/null | grep lsnode | grep -v grep || true)"
else
  remaining="$(ps aux | grep lsnode | grep -v grep || true)"
fi
if [ -z "$remaining" ]; then
  echo "    (ninguno)"
else
  echo "$remaining" | sed 's/^/    /'
fi

# ── [4] Git pull + npm install ───────────────────────────────────────────────
echo ""
echo "==> [4/5] Actualizando código..."

echo "    git fetch + reset (vhm)..."
(cd "$VHM_ROOT" && git fetch origin main && git reset --hard origin/main)

for app in "${APPS[@]}"; do
  dir="$VHM_ROOT/$app"
  [ -f "$dir/package.json" ] || continue
  echo "    npm install ($app)..."
  activate_nodevenv "$app"
  (cd "$dir" && npm install --omit=dev)
done

if [ -d "$OPENWA_DIR/.git" ] || [ -f "$OPENWA_DIR/.git" ]; then
  echo "    git fetch + reset (openwa)..."
  (cd "$OPENWA_DIR" && git fetch origin "$OPENWA_BRANCH" && git reset --hard "origin/$OPENWA_BRANCH")
  if [ -f "$OPENWA_DIR/package.json" ]; then
    echo "    npm install (openwa)..."
    activate_nodevenv "openwa"
    (cd "$OPENWA_DIR" && npm install --omit=dev)
  fi
else
  echo "    WARN: OpenWA no es un repo git en $OPENWA_DIR — omitido."
fi

if [ -f "$VHM_ROOT/site/public/DEPLOY_VERSION.txt" ]; then
  echo ""
  echo "    Versión site: $(cat "$VHM_ROOT/site/public/DEPLOY_VERSION.txt")"
fi

# ── [5] Start apps ───────────────────────────────────────────────────────────
if [ "$DO_RESTART" -eq 1 ]; then
  echo ""
  echo "==> [5/5] Iniciando apps Node..."
  bash "$VHM_ROOT/site/scripts/cpanel-restart-apps.sh" site crm latribu luma openwa
else
  echo ""
  echo "==> Código actualizado (sin reinicio)."
  echo "    Para reiniciar:"
  echo "      bash $VHM_ROOT/site/scripts/cpanel-restart-apps.sh site crm latribu luma openwa"
fi

echo ""
echo "==> Listo."
