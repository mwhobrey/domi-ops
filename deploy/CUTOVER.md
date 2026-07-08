# Production cutover (same droplet as HomeHub)

## Pre-flight

- [ ] `.env` on droplet: `POSTGRES_PASSWORD`, `SESSION_SECRET` (32+), `ENCRYPTION_KEY`, Google OAuth, `PUBLIC_APP_URL=https://your.domain`
- [ ] Each family member signs in with Google once (auto-joins imported household); set nicknames on Profile
- [ ] Google Cloud: both redirect URIs on `PUBLIC_APP_URL` ([docs/GOOGLE_OAUTH_SETUP.md](../docs/GOOGLE_OAUTH_SETUP.md))
- [ ] HomeHub `app.db` + `uploads/` paths known on server
- [ ] Worker env includes `GOOGLE_*`, `ENCRYPTION_KEY`, `REDIS_URL` (see `docker-compose.prod.yml`)

## Staging pass (required)

Use a **separate Postgres volume** so prod data stays untouched:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --build
# Migrations run via API container entrypoint
export DATABASE_URL=postgresql://domi_ops:$POSTGRES_PASSWORD@localhost:5433/domi_ops
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads --dry-run --strict
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads
```

Staging smoke (browser, not curl-only):

- [ ] Two Google accounts each claim a distinct imported member on **one** household
- [ ] Dashboard notice + home status edit
- [ ] Shopping, chores, notes, expenses interactive
- [ ] Calendar local event create/edit/delete
- [ ] School class → assignment → submit → presign upload → grade

```bash
./scripts/smoke-cutover.sh
# SMOKE_BASE_URL=https://staging.your.domain SMOKE_API_URL=... ./scripts/smoke-cutover.sh
```

## Production import

One-shot import container (or host `npm run import:homehub` with prod `DATABASE_URL`):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml --profile tools run --rm \
  -e DATABASE_URL=postgresql://domi_ops:$POSTGRES_PASSWORD@postgres:5432/domi_ops \
  -v /path/to/homehub/data:/import:ro \
  import --sqlite /import/app.db --uploads /import/uploads
```

Re-import is idempotent (`import_records` dedupe). Run dry-run first.

## Prod smoke tests

- [ ] `GET https://your.domain/api/health`
- [ ] Google login → dashboard (claim flow)
- [ ] `/school`, `/calendar`, core modules
- [ ] Calendar connect → worker processes `google.calendar.full_import`
- [ ] School presign upload lands in MinIO

## Caddy swap

1. Update Caddyfile: `reverse_proxy web:3000` (see [Caddyfile.example](./Caddyfile.example))
2. `caddy reload` or restart Caddy container
3. Verify HTTPS site loads whome

## Soak & rollback

- Run 24–48h before stopping HomeHub
- **Rollback:** revert Caddy upstream to HomeHub only; Postgres volume backup if needed

## After cutover

- Stop HomeHub compose stack when satisfied
- Keep `GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only` for this cutover (default in `.env.example`). Bidirectional Google push exists in code (`packages/calendar-sync/src/push.ts`) but is **not** enabled here — users can switch per-connection later in Calendar settings.
- Update `.cursor/runbook/04_CURRENT_STATE.md` with verified droplet behavior

---

## whobrey.me droplet (Mike)

**→ Full step-by-step runbook:** [CUTOVER-WHOBBREY.md](./CUTOVER-WHOBBREY.md) (secrets, Google OAuth, `headscale_default`, Caddy at `~/headscale/Caddyfile`, staging `:3002`).

Summary for the `services` droplet:

> **Windows (local) vs droplet (Linux)**
>
> Mike develops on **Windows**; cutover **runs on the Linux droplet** after SSH.
>
> | Where | What |
> |-------|------|
> | **Droplet (bash)** | All `docker compose`, HomeHub import mounts, `set -a && source .env`, `export PROXY_NETWORK`, Caddy reload, `scripts/smoke-cutover.sh` |
> | **Windows (PowerShell)** | `git push` / `git pull`, edit `.env` locally then `scp` to droplet, optional browser smoke against `http://<DROPLET_IP>:3002` (or SSH tunnel below) |
>
> Paths like `~/homehub/data/app.db` and `~/domi-ops` are **on the droplet** (Linux home dir), **not** `C:\Users\...`. HomeHub data already lives on the server — you do not copy `app.db` from Windows unless you are doing an off-box backup restore.

### Local Windows prep (PowerShell)

Use these **before** or **between** SSH sessions. Do **not** paste droplet bash blocks into PowerShell.

**SSH into droplet** (OpenSSH ships with Windows 10+):

```powershell
ssh user@your-droplet-ip
```

**Copy local `.env` to droplet** (edit on Windows, deploy to `~/domi-ops/.env`):

```powershell
scp .env user@your-droplet-ip:~/domi-ops/.env
```

**Repo sync** — pick one:

- **Local:** edit/commit on Windows, `git push`; on droplet after SSH: `cd ~/domi-ops && git pull`
- **Droplet-only:** `git clone … ~/domi-ops` once on the server, then `git pull` there

**Environment variables on Windows** — only for commands you run locally (e.g. a one-off local script). Droplet compose reads `~/domi-ops/.env`; loading it is **bash-only**:

```bash
# droplet only — do not run in PowerShell
set -a && source .env && set +a
```

In PowerShell, for a **local** session only: `$env:VAR = "value"` (or dot-source a script you wrote). There is no `export` — `export PROXY_NETWORK=…` in PowerShell does nothing useful for Docker on the droplet.

**Optional staging smoke from Windows** — browse `http://<DROPLET_IP>:3002` if the droplet firewall allows it, or tunnel web port:

```powershell
ssh -L 3002:127.0.0.1:3002 user@your-droplet-ip
# then open http://127.0.0.1:3002 in your browser
```

All sections below assume you are **already SSH'd into the droplet** unless labeled PowerShell.

| Item | Value |
|------|-------|
| Public URL | `https://whome.whobrey.me` |
| HomeHub SQLite | `~/homehub/data/app.db` |
| HomeHub uploads | `~/homehub/uploads` |
| HomeHub config | `~/homehub/config.yml` (parent of `data/` — required for claim emails) |
| Domi Ops repo on droplet | e.g. `~/domi-ops` (clone path is your choice) |
| Staging web | host `:3002` → container `web:3000` |
| Staging Postgres | host `:5433` → container `postgres:5432` (separate volume) |
| Prod Postgres | Compose volume `domi_ops_pg` — **included in stack**, no external DB |
| Caddy container / Caddyfile | `caddy` / `~/headscale/Caddyfile` |
| **Proxy network** | **`headscale_default`** (shared with `caddy` + `homehub`) |
| domi-ops Caddy upstream | `domi-ops-web:3000` |
| Prod Redis / MinIO | **Included in stack** — set `S3_ACCESS_KEY` / `S3_SECRET_KEY` in `.env` (MinIO root creds) |

### Decisions before you start

1. **Proxy Docker network** — confirmed on this droplet: **`headscale_default`**. Verify:

   ```bash
   docker inspect caddy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   docker inspect homehub --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   ```

   Staging on `:3002` does **not** need the proxy overlay — published port reaches `web` directly.

2. **Caddy** — container `caddy`, config `~/headscale/Caddyfile`. Add `whome.whobrey.me` block; see [CUTOVER-WHOBBREY.md](./CUTOVER-WHOBBREY.md) Phase 8.

3. **Compose project name** — default is the directory name (`Domi Ops`). Staging and prod **must not** both attach a service named `web` to the same proxy network. Use staging via **`:3002` only**, or run staging with `-p domi-ops-staging` and point Caddy at `domi-ops-staging-web-1:3000` if you need HTTPS on a staging subdomain.

### `.env` on droplet (production)

Copy from `.env.example`, then set at minimum:

```env
PUBLIC_APP_URL=https://whome.whobrey.me
API_URL=http://api:4000

POSTGRES_USER=whome
POSTGRES_PASSWORD=<strong-secret>
POSTGRES_DB=whome

SESSION_SECRET=<32+ chars>
ENCRYPTION_KEY=<32-byte secret>
AUTH_REQUIRED=true
DEPLOYMENT_MODE=single

REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=<minio-user>
S3_SECRET_KEY=<minio-secret>
S3_BUCKET=whome
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://whome.whobrey.me/s3   # or internal-only if you skip public MinIO URL

GOOGLE_OAUTH_CLIENT_ID=<from Google Cloud>
GOOGLE_OAUTH_CLIENT_SECRET=<from Google Cloud>
GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only

MODULES_ENABLED=core,school,calendar_sync,drive

# Only when using docker-compose.proxy-external.yml with Caddy (not needed for :3002 staging)
# PROXY_NETWORK=headscale_default
```

`DATABASE_URL` is overridden inside `docker-compose.prod.yml` for containers; host-side tools use staging URL below when rehearsing.

### Google OAuth (Google Cloud Console)

Under **Credentials → OAuth 2.0 Client → Authorized JavaScript origins**:

```
https://whome.whobrey.me
```

**Authorized redirect URIs** (exact match — see [docs/GOOGLE_OAUTH_SETUP.md](../docs/GOOGLE_OAUTH_SETUP.md)):

```
https://whome.whobrey.me/auth/callback/google
https://whome.whobrey.me/auth/google/calendar/callback
```

Add every family Google account as **Test users** while the consent screen is in Testing mode.

For **staging on :3002** (optional OAuth test before Caddy flip), also add:

```
http://<DROPLET_IP>:3002
http://<DROPLET_IP>:3002/auth/callback/google
http://<DROPLET_IP>:3002/auth/google/calendar/callback
```

…and temporarily set `PUBLIC_APP_URL=http://<DROPLET_IP>:3002` in `.env` for the staging stack only.

### External docker network (Caddy / HomeHub)

Prod compose is **self-contained** (Postgres, Redis, MinIO, API, worker, web). For Caddy on an existing HomeHub network, add the proxy overlay:

```yaml
# docker-compose.proxy-external.yml
networks:
  proxy:
    external: true
    name: ${PROXY_NETWORK:?Set PROXY_NETWORK}
```

`web` and `api` join `proxy`; Postgres/Redis/MinIO/worker stay on internal `domi_ops_internal`. Caddy must be on the **same** `PROXY_NETWORK` as `web`.

```bash
cd ~/domi-ops
PROXY_NETWORK=headscale_default docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.proxy-external.yml config | grep -A2 'networks:'
```

> **PowerShell:** set `PROXY_NETWORK` in the droplet `.env` or export after SSH — not in local PowerShell.

### Staging rehearsal (separate Postgres volume)

**Droplet (bash):**

```bash
cd ~/domi-ops
set -a && source .env && set +a

docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --build
# Migrations run via API container entrypoint on first boot
```

> **PowerShell:** `set -a && source .env` loads env vars in bash on the droplet. On Windows, use `scp` to place `.env` on the server, then run the block above **after** `ssh`.

Staging endpoints:

- Web: `http://<DROPLET_IP>:3002` (or from Windows: `ssh -L 3002:127.0.0.1:3002 user@droplet` then `http://127.0.0.1:3002`)
- Postgres (host import/debug): `localhost:5433`

**Import dry-run** (staging DB):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml --dry-run --strict
```

**Live staging import**:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml
```

Alternative single mount (config auto-discovered via `../config.yml` from `data/`):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --profile tools run --rm \
  -v ~/homehub:/import/homehub:ro \
  import --sqlite /import/homehub/data/app.db --uploads /import/homehub/uploads
```

Browser smoke on `:3002` (two Google accounts, claim distinct members, calendar/school/drive). Script:

```bash
# droplet only — bash env prefix, not PowerShell
SMOKE_BASE_URL=http://127.0.0.1:3002 SMOKE_API_URL=http://127.0.0.1:4000 ./scripts/smoke-cutover.sh
```

> **PowerShell:** `VAR=value command` is bash. Run this script on the droplet after SSH, or use WSL on Windows with the same syntax.

Note: API is not published on host by default — run smoke from inside the droplet with `docker compose exec` or temporarily expose API if needed. Primary gate is **browser** smoke per checklist above.

When satisfied, stop staging to free port 3002 before prod (or keep running with `-p domi-ops-staging` and different proxy routing):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml down
```

### Production deploy

**Droplet (bash):**

```bash
cd ~/domi-ops
set -a && source .env && set +a

PROXY_NETWORK=headscale_default docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.proxy-external.yml up -d --build
```

> **PowerShell:** SSH first; do not run `docker compose` against the droplet from Windows unless using a remote Docker context.

There is **no** external Domi Ops Postgres — compose creates volume `whome_domi_ops_pg` (name may include project prefix) on first `up`.

### Postgres backup (before prod import or re-import)

First import populates a new volume. Before **re-running** import on prod, snapshot the volume:

```bash
# Logical dump (stack must be up)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U domi_ops domi_ops | gzip > ~/backups/domi-ops-$(date +%Y%m%d-%H%M).sql.gz

# Or volume tarball (stack stopped)
docker compose -f docker-compose.prod.yml stop postgres
docker run --rm \
  -v whome_domi_ops_pg:/data:ro \
  -v ~/backups:/backup \
  alpine tar czf /backup/domi-ops-pg-volume-$(date +%Y%m%d).tar.gz -C /data .
docker compose -f docker-compose.prod.yml start postgres
```

Confirm volume name: `docker volume ls | grep domi_ops_pg`.

### Production import (one-liner)

Dry-run first:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml --dry-run --strict
```

Live:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-external.yml --profile tools run --rm \
  -v ~/homehub/data:/import/data:ro \
  -v ~/homehub/uploads:/import/uploads:ro \
  -v ~/homehub/config.yml:/import/config.yml:ro \
  import --sqlite /import/data/app.db --uploads /import/uploads --config /import/config.yml
```

Re-import is idempotent (`import_records` dedupe).

### Caddy: Domi Ops.whobrey.me

Add to your existing Caddy config (same file/network as HomeHub). See [Caddyfile.example](./Caddyfile.example).

```caddy
whome.whobrey.me {
    encode gzip zstd
    reverse_proxy domi-ops-web:3000
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

Reload:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

**Staging HTTPS (optional):** `staging.whome.whobrey.me { reverse_proxy domi-ops-staging-web-1:3000 }` only if staging stack uses a distinct compose project and container name on `PROXY_NETWORK`. Simpler: use `http://<DROPLET_IP>:3002` during rehearsal.

### Prod smoke

- [ ] `curl -sf https://whome.whobrey.me/api/health`
- [ ] Google login → dashboard; each member claims stub once
- [ ] `/school`, `/calendar`, shopping/chores/notes/expenses/drive
- [ ] Calendar connect → worker `google.calendar.full_import`
- [ ] School presign upload → MinIO

### Soak & rollback

- Run 24–48h parallel with HomeHub before stopping HomeHub compose
- **Rollback:** point Caddy back to HomeHub upstream; Domi Ops stack can stay stopped
- **Data rollback:** restore `~/backups/domi-ops-*.sql.gz` or volume tarball before re-import

### Stop HomeHub (after soak)

When Domi Ops is trusted:

```bash
cd ~/homehub   # existing HomeHub install
docker compose down   # adjust if HomeHub uses a different orchestration
```
