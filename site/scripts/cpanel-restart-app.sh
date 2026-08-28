#!/bin/bash
# Wrapper: reinicia site, crm y openwa. Para solo site: bash site/scripts/cpanel-restart-apps.sh site
exec bash "$(cd "$(dirname "$0")" && pwd)/cpanel-restart-apps.sh" "$@"
