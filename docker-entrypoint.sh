#!/bin/sh
set -eu

SESSION_PATH="${WHATSAPP_SESSION_PATH:-/app/.whatsapp-session}"

if [ -d "$SESSION_PATH" ]; then
  echo "Cleaning stale Chromium profile locks from $SESSION_PATH"
  find "$SESSION_PATH" \
    \( -name "SingletonLock" -o -name "SingletonSocket" -o -name "SingletonCookie" \) \
    -exec rm -rf {} + 2>/dev/null || true
fi

exec "$@"
