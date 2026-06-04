#!/usr/bin/env bash
set -euo pipefail

# Default smoke URL matches docker compose web; native dev: SMOKE_BASE_URL=http://localhost:3000
BASE_URL="${SMOKE_BASE_URL:-http://localhost:3001}"
API_URL="${SMOKE_API_URL:-http://localhost:4000}"

echo "== whome cutover smoke =="
echo "WEB: $BASE_URL"
echo "API: $API_URL"

curl -sf "$API_URL/health" | head -c 200
echo ""
echo "OK health"

if [[ -n "${DATABASE_URL:-}" && -n "${HOMEHUB_SQLITE:-}" ]]; then
  npm run import:homehub -- --sqlite "$HOMEHUB_SQLITE" --dry-run --strict
  echo "OK import dry-run"
else
  echo "SKIP import dry-run (set DATABASE_URL + HOMEHUB_SQLITE)"
fi

curl -sf -o /dev/null -w "%{http_code}\n" "$API_URL/auth/google/login" || true
echo "CHECK google login redirect (503 ok if OAuth unset locally)"

echo "Smoke complete — verify OAuth login + modules in browser before Caddy flip."
