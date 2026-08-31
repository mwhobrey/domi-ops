#!/usr/bin/env bash
# git pull, then pull GHCR images and restart the Domi Ops Hosted Starter stack
# (split infra — DO Managed Postgres + Spaces, see deploy/HOSTED_BETA_SETUP.md).
#
# Usage (on the droplet, from ~/domi-ops):
#   deploy/deploy-hosted.sh
#   DOMI_OPS_IMAGE_TAG=abc123 deploy/deploy-hosted.sh   # pin a specific build instead of latest
#
# The droplet is a git clone (read-only deploy key, HOSTED_BETA_SETUP.md
# "Prerequisites") of this repo — plain `docker compose pull`, no image builds happen
# here. `.env` and `Caddyfile` are untracked and stay put across a `git pull`.
#
# IMPORTANT — migrations: `docker-compose.hosted-prod.yml`'s `api` service deliberately
# overrides the image's entrypoint to SKIP `migrate.js` on boot. (The image's default
# entrypoint does run it automatically — apps/api/Dockerfile — but the restricted
# `domi_ops_app` role this stack's DATABASE_URL uses, NOBYPASSRLS/no DDL grants per
# packages/db/scripts/create-hosted-app-role.mjs, crash-loops on that unconditionally,
# even with nothing pending — confirmed live 2026-08-27, see HOSTED_BETA_SETUP.md.)
# Before touching any container, this script runs a read-only pending-migrations check
# (packages/db/scripts/check-pending-migrations.mjs, using the same restricted role — it only
# needs SELECT) and ABORTS if anything's unapplied, rather than trusting a human to remember.
# If it blocks you, apply the pending migration(s) via the ADMIN connection string FIRST, from
# any machine with this repo checked out (npm isn't installed on the droplet):
#     DATABASE_URL="<DO admin connection string>" npm run db:migrate
# then re-run this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# git pull can change this script's own content — a plain `bash deploy-hosted.sh` invocation may
# keep executing whatever it had already buffered from the pre-pull version, silently skipping
# anything the pull just added (confirmed live 2026-08-28: a newly-added step below was skipped
# entirely on the first deploy that pulled it in). Re-exec once, immediately after the pull and
# before anything else runs, so the rest of this script always comes from the file actually on
# disk. $DOMI_OPS_IMAGE_TAG and any other env the caller set survive — exec inherits environment,
# just not shell variables assigned below this point.
if [[ -z "${DOMI_OPS_REEXECED:-}" ]]; then
  echo "==> git pull"
  git pull --ff-only
  export DOMI_OPS_REEXECED=1
  exec bash "$REPO_ROOT/deploy/deploy-hosted.sh" "$@"
fi

COMPOSE=(
  docker compose
  -f docker-compose.hosted-prod.yml
  -f docker-compose.marketing.yml
  # demo-web is defined with `profiles: [demo]` (docker-compose.marketing.yml) — without this,
  # `up -d` silently leaves an already-running demo-web on whatever image it happened to be
  # started with, since compose only manages services whose profile is active in the current
  # invocation. Confirmed live 2026-08-31: it sat two days behind every other container across
  # several routine deploys before this was caught.
  --profile demo
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

echo "==> Domi Ops hosted update (tag: ${DOMI_OPS_IMAGE_TAG})"

echo "==> docker compose pull"
"${COMPOSE[@]}" pull

echo "==> checking for pending migrations"
if ! docker run --rm --env-file .env --entrypoint node \
    "ghcr.io/mwhobrey/domi-ops-api:${DOMI_OPS_IMAGE_TAG}" \
    packages/db/scripts/check-pending-migrations.mjs; then
  echo "" >&2
  echo "ABORTING deploy — containers were NOT touched. See message above." >&2
  exit 1
fi

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
  app_url="${PUBLIC_APP_URL%/}/api/healthz"
  app_json=""
  # api needs a moment to bind its listener after the container starts — redis is
  # already healthy from a prior deploy so the wait loop above exits almost instantly,
  # giving api no grace period. Retry instead of a single attempt (confirmed live
  # 2026-08-27: a bare single curl here false-positived on every clean deploy).
  for _ in $(seq 1 10); do
    app_json="$(curl -sf "$app_url" 2>/dev/null || true)"
    [[ -n "$app_json" ]] && break
    sleep 2
  done
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

echo "==> pruning dangling images"
# Every deploy pulls a new tag under the same "latest" name, leaving the previous image's layers
# dangling (untagged, unused) — dangling-only, never touches tagged/in-use images (confirmed live
# 2026-08-28: reclaimed 43.8GB after a run of deploys with no prune in between filled the disk to
# 99%, which then failed the api/worker image pull mid-deploy). Safe to run unconditionally.
docker image prune -f

echo "==> container status"
"${COMPOSE[@]}" ps

echo ""
echo "Done. Smoke-test: ${PUBLIC_APP_URL:-<PUBLIC_APP_URL unset>}/login and ${PUBLIC_MARKETING_URL:-<PUBLIC_MARKETING_URL unset>}"
