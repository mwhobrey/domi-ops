#!/usr/bin/env bash
# Pull GHCR images and restart Domi Ops prod stack (whome.whobrey.me pattern).
#
# Usage (on the droplet, from repo root):
#   ./deploy/update-prod.sh
#   ./deploy/update-prod.sh --no-git          # skip git pull
#   DOMI_OPS_IMAGE_TAG=abc123 ./deploy/update-prod.sh   # pin image tag
#
# Requires in .env:
#   POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, PUBLIC_APP_URL, …
#   PROXY_NETWORK=headscale_default   (or your Caddy network — docker network ls)
#
# Uses docker-compose.volumes-legacy.yml so Postgres/Redis/MinIO stay on
# whome_whome_* volumes (not empty whome_domi_ops_* from post-rename deploys).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(
  docker compose
  -f docker-compose.prod.yml
  -f docker-compose.proxy-external.yml
  -f docker-compose.volumes-legacy.yml
)

DO_GIT_PULL=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-git)
      DO_GIT_PULL=0
      shift
      ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "Missing .env in $REPO_ROOT — copy from .env.example first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${PROXY_NETWORK:?Set PROXY_NETWORK in .env (docker network ls — e.g. headscale_default)}"
export PROXY_NETWORK
export DOMI_OPS_IMAGE_TAG="${DOMI_OPS_IMAGE_TAG:-latest}"

echo "==> Domi Ops prod update (tag: ${DOMI_OPS_IMAGE_TAG}, network: ${PROXY_NETWORK})"

if [[ "$DO_GIT_PULL" -eq 1 ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "==> git pull"
  git pull --ff-only
fi

echo "==> docker compose pull (api, worker, web)"
"${COMPOSE[@]}" pull api worker web

echo "==> docker compose up (recreate app containers)"
"${COMPOSE[@]}" up -d --force-recreate --no-build api worker web

echo "==> waiting for postgres healthy"
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER:-domi_ops}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> data sanity (expect households > 0 on a live install)"
household_count="$("${COMPOSE[@]}" exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from households;"' \
  2>/dev/null | tr -d '\r\n' || true)"
household_count="${household_count:-?}"
echo "    households: ${household_count}"

if [[ "${household_count:-0}" == "0" ]]; then
  echo "WARNING: households=0 — wrong Postgres volume? Check:" >&2
  echo "  docker inspect \$(docker ps -qf name=postgres) --format '{{range .Mounts}}{{.Name}}{{end}}'" >&2
  echo "  Expected mount name: whome_whome_pg (legacy overlay)" >&2
fi

echo "==> setup status"
setup_url="${PUBLIC_APP_URL%/}/api/core/setup/status"
if command -v curl >/dev/null 2>&1 && [[ -n "${PUBLIC_APP_URL:-}" ]]; then
  setup_json="$(curl -sf "$setup_url" 2>/dev/null || true)"
  if [[ -n "$setup_json" ]]; then
    echo "    $setup_json"
    if echo "$setup_json" | grep -q '"needsSetup":true'; then
      echo "WARNING: needsSetup=true — greenfield or empty DB; Google login may require /setup" >&2
    fi
  else
    echo "    (curl failed for $setup_url — check Caddy / TLS from this host)"
  fi
else
  echo "    (skip: set PUBLIC_APP_URL and install curl for HTTP smoke test)"
fi

echo "==> container status"
"${COMPOSE[@]}" ps

echo ""
echo "Done. Smoke-test: https://${PUBLIC_APP_URL#https://}/login"
