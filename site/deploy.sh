#!/bin/bash
# Wrapper: delega al deploy unificado del repo (site + crm + openwa).
# Uso: cd ~/public_html && bash site/deploy.sh --restart

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/deploy.sh" "$@"
