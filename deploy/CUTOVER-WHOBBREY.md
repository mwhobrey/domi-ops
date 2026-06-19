# Cutover runbook — services droplet (Mike)

**Target:** `https://whome.whobrey.me` on the existing `services` droplet alongside HomeHub (`home.whobrey.me`).

**Parallel during soak:** HomeHub stays on `home.whobrey.me`; whome gets a new subdomain. No Caddy change to HomeHub until you trust whome.

| Item | Value |
|------|-------|
| Droplet user / host | `mike@services` |
| whome repo | `~/whome` |
| HomeHub SQLite | `~/homehub/data/app.db` |
| HomeHub uploads | `~/homehub/uploads` |
| HomeHub config | `~/homehub/config.yml` |
| Caddy container | `caddy` |
| Caddyfile (host) | `~/headscale/Caddyfile` |
| **Proxy Docker network** | **`headscale_default`** (Caddy + `homehub` share this) |
| whome web container | `whome-web` → port `3000` |
| Staging (rehearsal) | host `:3002` (no Caddy needed) |

> **Windows:** Edit/commit locally, `git push`, `scp .env` if needed, then **SSH** for all bash/docker commands below.

---

## Phase 0 — Checklist before you start

- [ ] DNS **A/AAAA** for `whome.whobrey.me` → droplet (same IP as `home.whobrey.me`)
- [ ] Repo cloned: `~/whome` from `https://github.com/mwhobrey/whome`
- [ ] HomeHub paths exist on droplet (`ls ~/homehub/data/app.db ~/homehub/config.yml`)
- [ ] Google OAuth client (Web application) — same client as HomeHub is fine if you add new URIs
- [ ] Google consent screen: **Privacy policy** → `https://whome.whobrey.me/privacy`
- [ ] Google consent screen: all family Google accounts added as **Test users** (Testing mode)
- [ ] `mkdir -p ~/backups`

---

## Phase 1 — Confirm Docker network

Caddy reaches HomeHub as `homehub:5000` on **`headscale_default`** (same network as the Caddy container from `~/headscale`).

```bash
docker inspect caddy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker inspect homehub --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

**Verified on `services` droplet:**

```
caddy   → headscale_default
homehub → headscale_default homehub_internal
```

Shared network for whome: **`headscale_default`**. (`homehub_internal` is HomeHub-only — do not use for Caddy.)

whome joins this network via `docker-compose.proxy-external.yml` so Caddy can `reverse_proxy whome-web:3000`.

---

## Phase 2 — Generate secrets

Run on the droplet (or locally, paste into `.env`):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')"
echo "S3_ACCESS_KEY=whome$(openssl rand -hex 4)"
echo "S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)"
```

| Variable | Purpose | Required |
|----------|---------|----------|
| `POSTGRES_PASSWORD` | Postgres + compose interpolation | **Yes** |
| `SESSION_SECRET` | Better Auth cookies (min 32 chars) | **Yes** |
| `ENCRYPTION_KEY` | Google OAuth token encryption (min 16 chars) | **Yes** |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO root user/pass (compose runs MinIO) | **Yes** |
| `GOOGLE_OAUTH_CLIENT_ID` / `SECRET` | Sign-in + calendar (`calendar_sync` module) | **Yes** |
| `VAPID_*` | Web Push notices | Optional |

**Optional Web Push** (run where Node/npm exists):

```bash
npx web-push generate-vapid-keys
# → set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:you@example.com
```

---

## Phase 3 — Create `~/whome/.env`

```bash
cd ~/whome
cp .env.example .env
micro .env   # or nano/vim
```

**Production template** (replace `<…>` with generated values):

```env
NODE_ENV=production

PUBLIC_APP_URL=https://whome.whobrey.me
API_URL=http://api:4000

AUTH_REQUIRED=true
ALLOW_PUBLIC_SIGNUP=false
DEPLOYMENT_MODE=single

POSTGRES_USER=whome
POSTGRES_PASSWORD=<from Phase 2>
POSTGRES_DB=whome
DATABASE_URL=postgresql://whome:<POSTGRES_PASSWORD>@postgres:5432/whome

SESSION_SECRET=<from Phase 2>
ENCRYPTION_KEY=<from Phase 2>

REDIS_URL=redis://redis:6379

S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=<from Phase 2>
S3_SECRET_KEY=<from Phase 2>
S3_BUCKET=whome
S3_FORCE_PATH_STYLE=true
# Required for HTTPS prod — presigned browser uploads (Caddy /s3 → minio:9000)
# Optional if using API upload proxy (default): browser PUT goes to /api/core/upload
# S3_PUBLIC_URL=https://whome.whobrey.me/s3/whome

GOOGLE_OAUTH_CLIENT_ID=<Google Cloud Console>
GOOGLE_OAUTH_CLIENT_SECRET=<Google Cloud Console>
GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only

MODULES_ENABLED=core,school,calendar_sync,drive

# Used with docker-compose.proxy-external.yml (Phase 6 prod)
PROXY_NETWORK=headscale_default
```

Load before compose commands:

```bash
cd ~/whome
set -a && source .env && set +a
```

---

## Phase 4 — Google Cloud Console

**Credentials → OAuth 2.0 Client (Web application)**

| Field | Add |
|-------|-----|
| Authorized JavaScript origins | `https://whome.whobrey.me` |
| Authorized redirect URIs | `https://whome.whobrey.me/auth/callback/google` |
| | `https://whome.whobrey.me/auth/google/calendar/callback` |

Keep existing `home.whobrey.me` / `:5000` URIs until HomeHub is retired.

**OAuth consent screen**

- Application home page: `https://whome.whobrey.me`
- Privacy policy: `https://whome.whobrey.me/privacy`
- Test users: every family Google account

---

## Phase 5 — Staging rehearsal (`:3002`)

Separate Postgres volume — prod data untouched. **No proxy overlay** (browser hits published port).

```bash
cd ~/whome
set -a && source .env && set +a

docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml ps
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml logs -f api --tail 50
# Wait for "Starting API..." after migrations
```

**Import dry-run:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml --dry-run --strict
```

**Live staging import:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml
```

**Browser smoke** at `http://<DROPLET_IP>:3002` (or `ssh -L 3002:127.0.0.1:3002 mike@services` from Windows):

- [ ] Two Google accounts each claim a **distinct** imported household member
- [ ] Dashboard notice + home status
- [ ] Shopping, chores, notes, expenses
- [ ] Calendar: create/edit/delete local event
- [ ] School: assignment → submit → upload → grade
- [ ] Drive: upload file

**Teardown staging** before prod (frees `:3002`):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml down
```

---

## Phase 5b — GHCR pull deploy (optional, WHO-133)

On-box `docker compose up --build` compiles three Node images (~45+ min, RAM-heavy). Prefer **private GHCR pulls** after the first CI publish.

**One-time setup**

1. GitHub → Settings → Actions → General → Workflow permissions → **Read and write packages** (for `GITHUB_TOKEN` on push to `main`).
2. **Create a droplet PAT — classic only** (fine-grained tokens do **not** support Packages/GHCR):
   - GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**
   - Note: e.g. `whome-droplet-ghcr-read`
   - Expiration: 90 days or custom (set a calendar reminder to rotate)
   - Scope: **`read:packages`** only (nothing else required for pull)
   - Copy the token once — you will not see it again.
3. On the droplet, export it **in the same SSH session** before login (replace with your token):

```bash
export GHCR_PAT='ghp_xxxxxxxxxxxxxxxxxxxx'   # or github_pat_... for fine-grained
echo "$GHCR_PAT" | docker login ghcr.io -u mwhobrey --password-stdin
# Expect: Login Succeeded
```

**Persist login** (optional — Docker stores creds in `~/.docker/config.json` after successful login; you do not need to re-export `GHCR_PAT` on every deploy unless you log out):

```bash
# Wrong — GHCR_PAT was never set:
# echo "$GHCR_PAT" | docker login ...   → "password is empty"

# Wrong — password is not a positional arg:
# docker login ghcr.io -u mwhobrey --password-stdin "mypassword"

# Wrong — interactive login over SSH without -T:
# echo "$GHCR_PAT" | docker login ghcr.io -u mwhobrey
```

To verify packages are reachable after login:

```bash
docker pull ghcr.io/mwhobrey/whome-api:latest
```

**Publish** (automatic): `.github/workflows/publish-images.yml` pushes on every `main`/`master` push and on `v*` tags:

| Image | Tag examples |
|-------|----------------|
| `ghcr.io/mwhobrey/whome-api` | `latest`, git sha |
| `ghcr.io/mwhobrey/whome-worker` | same |
| `ghcr.io/mwhobrey/whome-web` | same |
| `ghcr.io/mwhobrey/whome-import` | same |

**Deploy without building on droplet:**

```bash
cd ~/whome
git pull
set -a && source .env && set +a
export WHO_IMAGE_TAG=latest   # or pin to a git sha from Actions

docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml pull api worker web
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml up -d --no-build
```

Import profile (when needed): `pull import` then `--profile tools run --rm import …` (no `--build`).

**Free-tier limits:** GHCR storage/bandwidth caps apply; pin `WHO_IMAGE_TAG` to a sha and prune old package versions in GitHub Packages if needed.

**Off-box fallback** (no registry): build on a dev machine, `docker save ghcr.io/mwhobrey/whome-api:latest … | gzip`, `scp` to droplet, `docker load`.

---

## Phase 6 — Production stack

Full stack in one compose: **postgres, redis, minio, api, worker, web**.

```bash
cd ~/whome
set -a && source .env && set +a

docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.proxy-external.yml \
  up -d --build

docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml ps
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml logs api --tail 30
```

**Verify whome-web is on Caddy's network:**

```bash
docker network inspect headscale_default --format '{{range .Containers}}{{.Name}} {{end}}'
# Should include: caddy homehub whome-web (and possibly whome-api-1)
```

---

## Phase 7 — Production import

**Dry-run first:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml --dry-run --strict
```

**Live import:**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml
```

Re-import is idempotent. **Before re-import on prod**, backup Postgres:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U whome whome | gzip > ~/backups/whome-$(date +%Y%m%d-%H%M).sql.gz
```

---

## Phase 8 — Caddy (`~/headscale/Caddyfile`)

Add **below** the existing `home.whobrey.me` block (HomeHub stays until soak ends):

```caddy
whome.whobrey.me {
    encode gzip zstd

    # Drive / school / receipt presigned uploads (S3_PUBLIC_URL=https://whome.whobrey.me/s3/whome)
    handle_path /s3/* {
        reverse_proxy minio:9000
    }

    reverse_proxy whome-web:3000
    header {
        X-Forwarded-For {remote_host}
        X-Forwarded-Proto {scheme}
        X-Forwarded-Host {host}
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

`minio` must be on `headscale_default` — use `docker-compose.proxy-external.yml` when bringing up prod.

Reload (Caddy runs in Docker):

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
# If reload fails, validate first:
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
```

---

## Phase 9 — Production smoke

```bash
curl -sf https://whome.whobrey.me/api/health
```

Browser:

- [ ] `https://whome.whobrey.me/login` → Google sign-in
- [ ] Each family member claims their stub once → dashboard
- [ ] `/calendar` → Connect Google → import runs (worker logs)
- [ ] School artifact upload (MinIO via presign)
- [ ] `/privacy` loads (Google OAuth requirement)
- [ ] `home.whobrey.me` still serves HomeHub (unchanged)

**Worker / calendar import logs:**

```bash
docker compose -f docker-compose.prod.yml logs worker --tail 100 -f
```

---

## Phase 10 — Soak & cutover

- Run **24–48h** with both `home.whobrey.me` (HomeHub) and `whome.whobrey.me` (whome) live
- Family uses whome daily; compare parity with HomeHub

**Rollback** (instant):

1. Remove or comment out the `whome.whobrey.me` block in Caddyfile → `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`
2. Optional: `docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml down` (whome stopped; HomeHub unaffected)

**After soak — stop HomeHub:**

```bash
cd ~/homehub
docker compose down   # adjust if your HomeHub stack uses a different command
```

Optional: redirect `home.whobrey.me` → `whome.whobrey.me` in Caddy later.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `502` from Caddy | `docker ps` — is `whome-web` up? On `headscale_default`? |
| `web` not found on network | Use `whome-web:3000` not `web:3000`; confirm `container_name: whome-web` |
| API boot loop | `docker compose … logs api` — usually missing/short `SESSION_SECRET` or `ENCRYPTION_KEY` |
| Google `redirect_uri_mismatch` | URIs must exactly match `PUBLIC_APP_URL` paths in GCP |
| Import fails claim emails | `~/homehub/config.yml` mounted; check `auth.allowed_emails` / display names |
| Upload fails | MinIO up? `S3_ACCESS_KEY`/`S3_SECRET_KEY` match `.env`; API logs for presign errors |
| Calendar import stuck | Worker running? `GOOGLE_*` + `ENCRYPTION_KEY` in worker env (via `.env`) |

---

## Quick reference — copy/paste order

```bash
# 1. Secrets → paste into ~/whome/.env (Phase 2–3)
# 2. Google Cloud URIs (Phase 4)
# 3. Staging
cd ~/whome && set -a && source .env && set +a
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro -v ~/homehub/uploads:/import/uploads:ro -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml
# → browser smoke :3002, then down

# 4. Prod
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml up -d --build
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro -v ~/homehub/uploads:/import/uploads:ro -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml

# 5. Caddy block + reload
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
curl -sf https://whome.whobrey.me/api/health
```

See also: [CUTOVER.md](./CUTOVER.md) (generic), [GOOGLE_OAUTH_SETUP.md](../docs/GOOGLE_OAUTH_SETUP.md).
