# Domi Ops setup guide

This guide is for **household admins** who are comfortable with servers, SSH, and editing config files — but who are not necessarily software developers. It walks through every common setup path, what each setting does, and what we recommend for a typical family deployment.

**Google is optional.** You can run a complete household on email/password sign-in without touching Google Cloud at all.

---

## What you need

| Requirement | Why |
|-------------|-----|
| A Linux server (VPS) or home server | Production runs in Docker; 2 GB RAM minimum, 4 GB+ comfortable |
| A domain name (recommended) | HTTPS, OAuth, and phone install work best with a real URL |
| Docker + Docker Compose | Runs Postgres, Redis, file storage, API, worker, and web together |
| Secrets you generate once | Database password, session signing key, encryption key |

**Included in the stack** — you do not need separate managed Postgres, Redis, or S3 accounts unless you want to operate them yourself. The production compose file runs all of them for you.

---

## What works without Google

| Feature | Without Google |
|---------|----------------|
| Dashboard, notices, chores, shopping, notes, expenses | Yes |
| School (classes, assignments, gradebook) | Yes |
| Household Drive (files, folders, sharing) | Yes |
| Calendar (create and manage events in Domi Ops) | Yes |
| Email/password login + household members | Yes |
| Web Push notifications (with VAPID keys) | Yes |
| PWA install on phones | Yes |
| **Sign in with Google** | No — use email/password or provision usernames |
| **Import/sync Google Calendar** | No — use Domi Ops's calendar only, or import once if you set Google up later |

---

## Choose your setup path

| Path | Best for | Complexity |
|------|----------|------------|
| **[A] Try on your computer](#path-a-try-on-your-computer)** | Evaluating Domi Ops before committing a server | Low |
| **[B] Production on a server (build on box)](#path-b-production-on-a-server)** | First install, full control | Medium |
| **[C] Production with pre-built images](#path-c-production-with-pre-built-images)** | Updates without compiling on the server | Medium |
| **[D] Behind an existing reverse proxy](#path-d-behind-caddy-or-another-reverse-proxy)** | You already run Caddy, Traefik, or nginx | Medium |

For most households: **Path C + D** on a small VPS with a domain is the sweet spot.

---

## Path A: Try on your computer

Use this to click around before pointing a domain at a server.

### Option A1 — App on your machine, database in Docker (default)

```bash
git clone https://github.com/mwhobrey/domi-ops.git
cd domi-ops
cp .env.example .env
```

Edit `.env` — at minimum set long random values for `SESSION_SECRET` and `ENCRYPTION_KEY` (see [Generating secrets](#generating-secrets)).

```bash
docker compose up -d postgres redis minio
npm install
npm run build
npm run db:migrate
npm run dev
```

Open **http://localhost:3000**.

### Option A2 — Everything in Docker (web on port 3001)

```bash
cp .env.docker.example .env
docker compose up --build
```

Open **http://localhost:3001**.

> **Pick one port and stick with it.** If you later enable Google sign-in, redirect URIs must match the URL you actually use (`3000` vs `3001`).

### Reset local data

```bash
npm run dev:reset
npm run dev
```

### Demo household (marketing screenshots)

After migrations, seed the **Rivera Family** demo household for landing-page screenshots and local QA:

```bash
npm run db:seed-demo
```

| | |
|---|---|
| **Login** | `demo@domi-ops.com` |
| **Password** | `DemoRivera2026!` (or set `DEMO_OWNER_PASSWORD` in `.env`) |
| **Slug** | `rivera-demo` |
| **Best views** | `/calendar` (week view), `/dashboard`, `/school` |

Re-running the command wipes and recreates the demo household (idempotent by slug). Safety gate: runs when `NODE_ENV` is not `production`, or `DEMO_MODE=true`, or with `--force`.

Capture marketing PNGs (Playwright; requires `npm run dev`). Captures **light and dark** variants (`-{theme}.png`) into `docs/marketing/screenshots/` and `apps/www/public/marketing/screenshots/`:

```bash
npx playwright install chromium   # once per machine
npm run marketing:capture-screenshots
npm run marketing:capture-screenshots -- --theme light   # single theme pass
```

Preview the marketing landing: `npm run dev:www` → `http://localhost:3002`.

Output filenames: `p0-calendar-week-desktop-1280x800-light.png` (and `-dark.png`).

Full spec: [marketing/demo-household-spec.md](./marketing/demo-household-spec.md).

---

## Path B: Production on a server

### 1. Prepare the server

- Ubuntu 22.04+ or similar
- Install [Docker Engine](https://docs.docker.com/engine/install/) and the Compose plugin
- Point DNS **A/AAAA** for your hostname (e.g. `home.example.com`) at the server

### 2. Clone and configure

```bash
git clone https://github.com/mwhobrey/domi-ops.git
cd domi-ops
cp .env.example .env
```

Edit `.env` with your editor (`nano .env` is fine). Use the [configuration reference](#configuration-reference) below. Minimum production checklist:

```env
NODE_ENV=production
PUBLIC_APP_URL=https://home.example.com
AUTH_REQUIRED=true
ALLOW_PUBLIC_SIGNUP=false

POSTGRES_PASSWORD=<generate>
SESSION_SECRET=<generate — at least 32 characters>
ENCRYPTION_KEY=<generate>
SETUP_TOKEN=<generate — at least 16 characters; for /setup wizard>

S3_ACCESS_KEY=<generate>
S3_SECRET_KEY=<generate>

MODULES_ENABLED=core,school,calendar_sync,drive
```

Load env before compose commands:

```bash
set -a && source .env && set +a
```

### 3. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Wait for the API to finish migrations (check logs):

```bash
docker compose -f docker-compose.prod.yml logs api --tail 30
```

### 4. Put HTTPS in front

Domi Ops's web container listens on port 3000 **inside Docker**. Browsers should hit **HTTPS** on your domain via a reverse proxy.

See [Path D](#path-d-behind-caddy-or-another-reverse-proxy) for Caddy. Until then you can smoke-test with an SSH tunnel:

```bash
# On your laptop:
ssh -L 3000:127.0.0.1:3000 user@your-server
```

---

## Path C: Production with pre-built images

After the first install, prefer **pulling images** instead of rebuilding on the server (faster, less RAM).

**One-time:** log in to GitHub Container Registry on the server:

```bash
# Classic PAT with read:packages scope — see deploy/CUTOVER-WHOBBREY.md
export GHCR_PAT='ghp_xxxxxxxx'
echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

**Each update:**

```bash
cd ~/domi-ops
git pull
set -a && source .env && set +a

export DOMI_OPS_IMAGE_TAG=latest   # or pin to a version tag, e.g. 0.1.0

docker compose -f docker-compose.prod.yml pull api worker web
docker compose -f docker-compose.prod.yml up -d --no-build
```

Migrations run automatically when the API container starts. After updates that add worker jobs (e.g. reminder scans), restarting the worker is enough — `up -d` handles it.

---

## Path D: Behind Caddy or another reverse proxy

If Caddy (or nginx) already runs in Docker on a shared network:

```bash
export PROXY_NETWORK=your_proxy_network   # e.g. headscale_default
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.proxy-external.yml \
  up -d --no-build
```

Add a site block (see `deploy/Caddyfile.example`):

```caddy
home.example.com {
    encode gzip zstd
    reverse_proxy domi-ops-web:3000
}
```

Reload Caddy. Confirm the `domi-ops-web` container appears on the proxy network:

```bash
docker network inspect your_proxy_network --format '{{range .Containers}}{{.Name}} {{end}}'
```

---

## First login and household setup

Greenfield installs (`ALLOW_PUBLIC_SIGNUP=false`, no HomeHub import) use a **one-time setup token** — not a temporary public sign-up flip.

### Option 1 — Web wizard (recommended)

1. Generate a long random secret and add to `.env`:

```env
SETUP_TOKEN=your-long-random-setup-token-min-16-chars
```

2. Restart the API (and web if env is baked in).
3. Open **`https://home.example.com/setup`** (or `http://localhost:3000/setup` in dev).
4. Enter the setup token, owner email, and password (or use Google after unlocking with the token).
5. After the first household exists, setup is closed automatically — remove or rotate `SETUP_TOKEN` in `.env` if you like.

### Option 2 — Headless CLI (SSH / no browser)

On the server with `DATABASE_URL` and `SETUP_TOKEN` in the environment:

```bash
npm run bootstrap:owner -- --email owner@example.com --password 'YourSecurePassword123'
```

Optional: `--name "Alex"` `--household "Rivera Home"`.

Then sign in at `/login`.

### After the owner exists

1. Go to **Settings** (owner/admin) → household name, timezone, **module toggles**.
2. **Members:** provision username-only accounts for kids, or invite adults via email/Google.
3. **Profile:** display name, avatar, notifications, optional PWA install.

Recommended next steps:

- Install the PWA on family phones (browser menu → Add to Home Screen).
- Enable Web Push on each device (Profile → notifications → “Enable on this device”) if you configured VAPID keys.
- Set weather location on the dashboard (browser geolocation or city search).

---

## Google integration (optional)

Google setup unlocks **Sign in with Google** and **Google Calendar import/sync**. Skip this section if email/password is enough.

### What to create in Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External** (or Internal for Workspace-only).
   - App name, support email, developer contact.
   - **Application home page:** `https://home.example.com`
   - **Privacy policy:** `https://home.example.com/privacy` (Domi Ops ships a minimal policy page).
   - **Publishing status:** **Testing** is fine for family use — add every family Gmail under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - **Authorized JavaScript origins:** `https://home.example.com` (no trailing slash)
   - **Authorized redirect URIs** — both required, exact match:
     - `https://home.example.com/auth/callback/google` (sign-in)
     - `https://home.example.com/auth/google/calendar/callback` (calendar connect)
4. Copy **Client ID** and **Client secret** into `.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
```

5. Restart API and web:

```bash
docker compose -f docker-compose.prod.yml up -d api web
```

### Calendar sync modes

Set in `.env` — default is safest for migration:

| Value | Behavior |
|-------|----------|
| `import_only` | **Recommended default.** One-time import from Google; Domi Ops is source of truth after. |
| `manual` | Import available; ongoing sync only when you trigger it. |
| `bidirectional` | Changes in Domi Ops push back to Google (advanced). |

Per-connection mode can also be changed in the app under Calendar settings.

### Local dev + Google

Redirect URIs must use the **exact origin** you open in the browser:

| How you run Domi Ops | `PUBLIC_APP_URL` | Origins + redirects in GCP |
|-------------------|------------------|----------------------------|
| `npm run dev` | `http://localhost:3000` | `http://localhost:3000/...` |
| Docker compose dev | `http://localhost:3001` | `http://localhost:3001/...` |

Detailed troubleshooting: [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md).

---

## Configuration reference

All settings live in `.env` at the repo root. Production containers read this file via `env_file`.

### Required for production

| Variable | What it does |
|----------|----------------|
| `PUBLIC_APP_URL` | The URL families type in the browser (`https://home.example.com`). Drives OAuth redirects and cookie scope. **Must match your domain exactly.** |
| `POSTGRES_PASSWORD` | Database password (compose uses it to build `DATABASE_URL` inside containers). |
| `SESSION_SECRET` | Signs login cookies. **At least 32 random characters.** Never reuse across apps. |
| `ENCRYPTION_KEY` | Encrypts stored OAuth tokens and health fields. Generate once; **do not rotate** without re-connecting Google / re-encrypting health data. |
| `SETUP_TOKEN` | Greenfield only (min 16 chars). Unlocks `/setup` and `bootstrap:owner`. Remove or rotate after first household exists. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO credentials in the bundled stack. Treat like a password. |
| `AUTH_REQUIRED` | Keep `true` in production. |

### Authentication

| Variable | Default | Notes |
|----------|---------|-------|
| `ALLOW_PUBLIC_SIGNUP` | off in production | When `false`, use `SETUP_TOKEN` + `/setup` for the first owner. |
| `GOOGLE_OAUTH_CLIENT_ID` / `SECRET` | empty | Optional. Required only for Google sign-in or calendar sync. |
| `EMAIL_VERIFICATION_REQUIRED` | off | Optional. Pair with `SMTP_*` vars for verified email sign-up. |

**Sign-in options in practice:**

- **Email + password** — works out of the box.
- **Username-only members** — owner provisions accounts in Settings (good for kids).
- **Google** — optional; see above.

### Modules

`MODULES_ENABLED` lists what the server *can* offer. Owners turn modules on/off per household in **Settings**.

| Module key | What it includes |
|------------|------------------|
| `core` | Always on — dashboard, shopping, chores, notes, expenses, notices |
| `school` | Homeschool LMS |
| `calendar_sync` | Google Calendar connect (requires Google OAuth + worker) |
| `drive` | Household file storage |

**Recommended default:** `core,school,calendar_sync,drive` — disable in Settings if you do not need school or drive yet.

### File storage (Drive, uploads, avatars)

Bundled MinIO uses `S3_*` variables. Defaults are fine for self-host.

| Variable | Purpose |
|----------|---------|
| `DRIVE_UPLOAD_MAX_BYTES` | Max single upload (default 10 MB). |
| `DRIVE_DEFAULT_QUOTA_BYTES` | Household storage cap (default 10 GB). |
| `DRIVE_QUOTA_ENFORCE` | Set `true` to hard-block over-quota uploads. |
| `DRIVE_PUBLIC_SHARES_ENABLED` | `false` to disable public `/s/:token` links. |

### Web Push (optional)

Browser notifications for notices, calendar/chore/school reminders, budget alerts.

```bash
npx web-push generate-vapid-keys
```

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Each family member must opt in under **Profile → notifications** and tap **Enable on this device**. iOS requires installing the PWA first (iOS 16.4+).

Medication reminders support **Taken** / **Skip** action buttons on Chromium/Android. **iOS PWA does not show notification action buttons** — tapping the notification opens Health and auto-logs via a signed deep link instead. Caregivers with **Dose helper** (or any `doses: write`) on [Health → Sharing](/health/sharing) also receive reminders when their Profile health-med push toggle is on.

### Weather

No API key needed (Open-Meteo). Users pick location in the app. Optional server default:

```env
# WEATHER_LATITUDE=41.88
# WEATHER_LONGITUDE=-87.63
# WEATHER_LOCATION_LABEL=Chicago
```

### Email (optional)

For password reset / verification:

```env
EMAIL_VERIFICATION_REQUIRED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=noreply@example.com
```

---

## Recommended setups

### Minimal — no Google, smallest attack surface

```env
MODULES_ENABLED=core,school,drive
# Leave GOOGLE_OAUTH_* empty
ALLOW_PUBLIC_SIGNUP=false
```

Use email/password or provisioned usernames. Calendar lives entirely in Domi Ops.

### Typical family — Google sign-in + calendar import

```env
MODULES_ENABLED=core,school,calendar_sync,drive
GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Connect Google once per adult under Profile / Calendar settings. Import household calendar, then run day-to-day in Domi Ops.

### Full experience — notifications + mobile

Everything in “Typical family”, plus:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:household@example.com
```

Each person: install PWA → Profile → enable push on that device.

---

## Best practices

### Secrets

Generate strong values — never commit `.env` to git:

```bash
openssl rand -base64 48 | tr -d '\n'    # SESSION_SECRET
openssl rand -base64 32 | tr -d '\n'    # ENCRYPTION_KEY
openssl rand -base64 32 | tr -d '/+=' | head -c 32   # POSTGRES_PASSWORD
```

Store a copy in your password manager. Back up `.env` securely with your server backups.

### HTTPS

Always terminate TLS at your reverse proxy. Set `PUBLIC_APP_URL` to `https://…` — not `http://`.

### Backups

Back up Postgres regularly (household data lives there; files live in MinIO volume):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U domi_ops domi_ops | gzip > ~/backups/domi-ops-$(date +%Y%m%d).sql.gz
```

Include Docker volumes `domi_ops_pg` and `domi_ops_minio` in volume-level backups if you snapshot the whole machine.

### Updates

1. Back up Postgres.
2. `git pull` on the server.
3. Pull new images (`DOMI_OPS_IMAGE_TAG`) or `--build` if you compile locally.
4. `docker compose … up -d` — migrations run on API start.
5. Smoke-test login, dashboard, one module you use daily.

Installed PWAs show an **“Update available — Reload”** banner when the service worker updates.

### Security defaults we recommend

| Setting | Recommendation |
|---------|----------------|
| `ALLOW_PUBLIC_SIGNUP` | `false` after owner exists |
| `AUTH_REQUIRED` | `true` |
| `DRIVE_PUBLIC_SHARES_ENABLED` | `true` only if you use share links; otherwise `false` |
| Google OAuth | Testing mode + explicit test users until you publish the app |
| Firewall | Expose only 80/443 to the internet; Postgres/Redis/MinIO stay internal |

### Staging before production changes

Use a separate compose overlay so you do not touch live data:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d
# Test on host port 3002
```

See `deploy/CUTOVER.md` for a generic cutover checklist. Operator-specific migration notes live under `deploy/CUTOVER-*.md` (not required for greenfield installs).

### One household per database

Self-host uses `DEPLOYMENT_MODE=single` — one Postgres instance serves one household. This is intentional and simplest for families.

---

## In-app settings (after install)

These do not require editing `.env`:

| Where | What |
|-------|------|
| **Settings → Modules** | Turn school, drive, calendar sync on/off for your household |
| **Settings → Members** | Roles, provision child accounts, invite adults |
| **Settings → Integrations** | Health check: Google, VAPID, storage |
| **Profile → Notifications** | Per-person push toggles (notices, calendar, chores, school, budgets) |
| **Profile → Calendar** | Connect Google, sync mode, import wizard |
| **Calendar → Settings** | Household calendars, categories, Google sheet |

---

## Migrating from HomeHub (optional)

If you previously ran [HomeHub](https://github.com/surajverma/homehub), Domi Ops can import SQLite data and uploads. This is not required for new households.

See [HOMEHUB_IMPORT.md](./HOMEHUB_IMPORT.md). Always run `--dry-run` first.

---

## Troubleshooting

See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** for the full index. Common issues:

| Problem | Likely fix |
|---------|------------|
| Cannot create first owner | Set `SETUP_TOKEN`, open `/setup`, or `npm run bootstrap:owner` |
| Google “redirect_uri_mismatch” | Redirect URIs in GCP must **exactly** match `PUBLIC_APP_URL` paths |
| GHCR `pull access denied` | `docker login ghcr.io` with PAT (`read:packages`) — [Path C](#path-c-production-with-pre-built-images) |
| Login works on one port but not another | You mixed `3000` and `3001` — pick one dev profile |
| “Unauthorized” everywhere | Session cookie issue — confirm `PUBLIC_APP_URL` matches browser URL and HTTPS |
| Calendar sync never runs | Worker container up? `REDIS_URL` set? Google OAuth + `calendar_sync` enabled? |
| Uploads fail | Check API logs; verify MinIO is running and `S3_*` keys match |
| Push notifications silent | `VAPID_*` set? User enabled push in Profile? PWA installed on iOS? |
| Database errors after update | API logs — migrations run on API start; see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |

More detail: [SELF_HOST.md](./SELF_HOST.md) · [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)

---

## Generating secrets

Quick reference (run on any machine with OpenSSL):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')"
echo "SETUP_TOKEN=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
echo "S3_ACCESS_KEY=domi_ops_$(openssl rand -hex 4)"
echo "S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)"
```

Paste into `.env`, then `set -a && source .env && set +a` before `docker compose`.

---

## Further reading

| Doc | Contents |
|-----|----------|
| [SELF_HOST.md](./SELF_HOST.md) | Technical self-host reference |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common failures index |
| [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) | Pre-launch security checklist |
| [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) | Google Cloud step-by-step |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design; self-host and hosted tiers launch together at public release |
| [README.md](../README.md) | Project overview |
