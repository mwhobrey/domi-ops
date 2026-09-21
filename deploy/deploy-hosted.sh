#!/usr/bin/env bash
# git pull, then pull GHCR images and restart the Domi Ops Hosted Starter stack
# (split infra — DO Managed Postgres + Spaces, see deploy/HOSTED_BETA_SETUP.md).
#
# Usage (on the droplet, from ~/domi-ops):
#   deploy/deploy-hosted.sh
#   deploy/deploy-hosted.sh --migrate
#   DOMI_OPS_IMAGE_TAG=abc123 deploy/deploy-hosted.sh   # pin a specific build instead of latest
#
# --migrate applies pending DDL using DATABASE_URL_ADMIN from your *shell* (export it in
# ~/.bashrc on the droplet — do not put the admin URL in compose .env). Order: migrate →
# re-grant domi_ops_app → pending check → compose up. Never uses the restricted app
# DATABASE_URL for DDL.
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
# If it blocks you, re-run with --migrate (after exporting DATABASE_URL_ADMIN in your shell)
# or apply migrations from another machine: DATABASE_URL="<admin>" npm run db:migrate

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RUN_MIGRATE=0
SHOW_HELP=0
for arg in "$@"; do
  case "$arg" in
    --migrate) RUN_MIGRATE=1 ;;
    -h|--help) SHOW_HELP=1 ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

usage() {
  cat <<'EOF'
Usage: deploy/deploy-hosted.sh [OPTIONS]

  (no flags)   git pull, pull GHCR images, pending-migration check, compose up
  --migrate    Apply pending DB migrations and re-grant domi_ops_app, then continue deploy

  Requires DATABASE_URL_ADMIN in the shell (e.g. export in ~/.bashrc) when using --migrate.
  Do not put the admin connection string in compose .env.

  -h, --help   Show this help

Environment:
  DOMI_OPS_IMAGE_TAG   GHCR tag to pull (default: latest)
EOF
}

if [[ "$SHOW_HELP" -eq 1 ]]; then
  usage
  exit 0
fi

# Admin URL for --migrate: capture from the caller's shell before .env is sourced (operators
# export DATABASE_URL_ADMIN in ~/.bashrc — not stored in compose .env).
if [[ "$RUN_MIGRATE" -eq 1 ]]; then
  MIGRATE_ADMIN_URL="${DATABASE_URL_ADMIN:-}"
fi

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

if [[ "$RUN_MIGRATE" -eq 1 && -z "${MIGRATE_ADMIN_URL:-}" ]]; then
  echo "ERROR: --migrate requires DATABASE_URL_ADMIN in your shell environment." >&2
  echo "       Export the DO admin connection string (e.g. in ~/.bashrc), open a new shell or" >&2
  echo "       source ~/.bashrc, then re-run: deploy/deploy-hosted.sh --migrate" >&2
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

if [[ "$RUN_MIGRATE" -eq 1 ]]; then
  echo "==> applying database migrations (admin connection)"
  "${COMPOSE[@]}" run --rm -T --no-deps \
    -e "DATABASE_URL=${MIGRATE_ADMIN_URL}" \
    --entrypoint node api \
    packages/db/dist/migrate.js

  echo "==> re-granting domi_ops_app (new tables need grants)"
  # DOMI_OPS_APP_PASSWORD comes from api's env_file (.env); DATABASE_URL is admin only here.
  "${COMPOSE[@]}" run --rm -T --no-deps \
    -e "DATABASE_URL=${MIGRATE_ADMIN_URL}" \
    --entrypoint node api \
    packages/db/scripts/create-hosted-app-role.mjs
fi

echo "==> checking for pending migrations"
# Must run on the compose network, not a bare `docker run` — DATABASE_URL can point at a
# compose-local Postgres service (hostname "postgres", the self-host default) which only
# resolves from containers actually attached to this project's network. `docker compose run`
# reuses the api service's already-correct networks/env_file instead of us re-deriving them.
# Confirmed live 2026-09-02: a bare `docker run --env-file .env` here hit
# `getaddrinfo ENOTFOUND postgres` on a self-hosted-style setup — aborted clean without
# touching containers, but every such deploy would fail here as long as this script existed.
if ! "${COMPOSE[@]}" run --rm -T --no-deps --entrypoint node api \
    packages/db/scripts/check-pending-migrations.mjs; then
  echo "" >&2
  echo "ABORTING deploy — containers were NOT touched. See message above." >&2
  if [[ "$RUN_MIGRATE" -ne 1 ]]; then
    echo "Hint: on the droplet, export DATABASE_URL_ADMIN in ~/.bashrc, then re-run with:" >&2
    echo "      deploy/deploy-hosted.sh --migrate" >&2
  fi
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
