#!/usr/bin/env bash
# git pull, then pull GHCR images and restart the Domi Ops Hosted Starter stack
# (split infra — DO Managed Postgres + Spaces, see deploy/HOSTED_BETA_SETUP.md).
#
# Usage (on the droplet, from ~/domi-ops):
#   deploy/deploy-hosted.sh
#   DOMI_OPS_IMAGE_TAG=abc123 deploy/deploy-hosted.sh   # pin a specific build instead of latest
#
# The droplet is a shallow-ish git clone (read-only deploy key, HOSTED_BETA_SETUP.md
# "Prerequisites") of this repo — plain `docker compose pull`, no image builds happen
# here. `.env` and `Caddyfile` are untracked and stay put across a `git pull`.
#
# IMPORTANT — migrations: the api/worker images run `migrate.js` automatically on
# every container start, baked into the entrypoint (apps/api/Dockerfile). But this
# stack's DATABASE_URL uses the restricted `domi_ops_app` role (NOBYPASSRLS, no
# DDL grants — packages/db/scripts/create-hosted-app-role.mjs). That role can
# SELECT to confirm "nothing pending" and the container starts normally, but it
# CANNOT apply a new migration. If this deploy ships one, apply it via the ADMIN
# connection string FIRST, from any machine with this repo checked out:
#     DATABASE_URL="<DO admin connection string>" npm run db:migrate
# — or api/worker will crash-loop on a permission-denied error the moment this
# script restarts them. This script cannot do that step for you (no repo/npm on
# this droplet by design) — it only pauses to give you a chance to back out.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(
  docker compose
  -f docker-compose.hosted-prod.yml
  -f docker-compose.marketing.yml
)

if [[ ! -f .env ]]; then
  echo "Missing .env in $REPO_ROOT — see deploy/HOSTED_BETA_SETUP.md." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

export DOMI_OPS_IMAGE_TAG="${DOMI_OPS_IMAGE_TAG:-latest}"

echo "==> git pull"
git pull --ff-only

echo "==> Domi Ops hosted update (tag: ${DOMI_OPS_IMAGE_TAG})"
echo "==> If this deploy includes a NEW migration, it must already be applied via"
echo "    the admin connection string (see script header) — 5s to Ctrl+C if not."
sleep 5

echo "==> docker compose pull"
"${COMPOSE[@]}" pull

echo "==> docker compose up (recreate changed containers only)"
"${COMPOSE[@]}" up -d --no-build --remove-orphans

echo "==> waiting for redis healthy"
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T redis redis-cli ping >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> app health"
if command -v curl >/dev/null 2>&1 && [[ -n "${PUBLIC_APP_URL:-}" ]]; then
  app_url="${PUBLIC_APP_URL%/}/health"
  app_json="$(curl -sf "$app_url" 2>/dev/null || true)"
  if [[ -n "$app_json" ]]; then
    echo "    $app_json"
  else
    echo "WARNING: curl failed for $app_url — check api/Caddy logs" >&2
  fi
fi

echo "==> marketing site"
if command -v curl >/dev/null 2>&1 && [[ -n "${PUBLIC_MARKETING_URL:-}" ]]; then
  marketing_url="${PUBLIC_MARKETING_URL%/}"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$marketing_url" 2>/dev/null || echo '000')"
  echo "    $marketing_url -> HTTP $code"
  if [[ "$code" != "200" ]]; then
    echo "WARNING: marketing site not returning 200" >&2
  fi
fi

echo "==> container status"
"${COMPOSE[@]}" ps

echo ""
echo "Done. Smoke-test: ${PUBLIC_APP_URL:-<PUBLIC_APP_URL unset>}/login and ${PUBLIC_MARKETING_URL:-<PUBLIC_MARKETING_URL unset>}"
