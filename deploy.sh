#!/bin/bash
# Wrapper: delega a site/deploy.sh
exec bash "$(cd "$(dirname "$0")" && pwd)/site/deploy.sh" "$@"
