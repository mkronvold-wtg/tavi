#!/bin/sh
set -eu

# Image links /app/dist/runtime-config.js -> /tmp/runtime-config.js for read-only root FS.
runtime_config_path="/tmp/runtime-config.js"

node -e "process.stdout.write('window.__TAVI_RUNTIME_CONFIG__ = ' + JSON.stringify({ apiBaseUrl: process.env.TAVI_API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? '', appHomeUrl: process.env.TAVI_HOME_URL ?? '' }) + ';\n')" > "${runtime_config_path}"

exec node /app/scripts/serve-dist.mjs "$@"
