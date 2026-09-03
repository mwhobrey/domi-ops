# Hosted Starter — private beta setup (real production infra)

Provisioning runbook for the **private beta** decided in [.cursor/runbook/07_LAUNCH.md](../.cursor/runbook/07_LAUNCH.md) — `app.domi-ops.com` and `domi-ops.com` go live for real, ahead of the OSS repo flip, so one invited outside tester can go through the actual marketing → checkout → onboarding path. Architecture is [ADR 003](../docs/adr/003-hosted-db-architecture.md) as signed off, not a scaled-down version — this becomes the real Hosted Starter production environment, not throwaway.

**Compute vs. managed split** (see cost comparison in session notes / `07_LAUNCH.md`): the droplet runs API + worker + web + Redis only. Postgres and object storage are external managed services. This makes the droplet stateless — redeploying is just pulling new images, nothing to back up on the box itself.

| Piece | Where | Approx. cost |
|-------|-------|--------------|
| Compute (API/worker/web/Redis/Caddy) | 1 DigitalOcean droplet, 2GB/1vCPU | ~$12/mo |
| Database | DigitalOcean Managed Postgres, 1GB Basic | ~$15/mo |
| Object storage (Drive) | DigitalOcean Spaces, 250GB + CDN | ~$5/mo |
| **Total** | | **~$32/mo** |

Matches the "~$30–40/mo fixed infra" already budgeted in [PRICING_TIERS.md](../docs/marketing/PRICING_TIERS.md) economics — this is the real number, not a new one.

---

## Prerequisites

- [ ] DigitalOcean account with billing set up
- [ ] `domi-ops.com` registrar access (for DNS records)
- [ ] GHCR pull access — classic PAT with `read:packages` scope (same as [SETUP.md Path C](../docs/SETUP.md#path-c-production-with-pre-built-images))
- [ ] Stripe account (existing per [ADR 001](../docs/adr/001-public-launch-scope.md)) — dashboard access
- [ ] CI publishing images to GHCR on `main` — already true ([publish-images.yml](../.github/workflows/publish-images.yml))

The droplet runs a real `git clone` of this repo, authenticated with a **read-only deploy key**
(`gh repo deploy-key add` — repo → Settings → Deploy keys) so `deploy/deploy-hosted.sh` can
`git pull` before each redeploy instead of someone hand-copying compose files whenever they
change. It still never builds images — only pulls pre-built GHCR ones (`--no-build`). `.env` and
`Caddyfile` are untracked, live only on the droplet, and survive a `git pull` untouched.

---

## 1. DigitalOcean Managed Postgres

1. Create a cluster: **Postgres 18** (no version-specific SQL in this app's migrations — Drizzle, plain enums, standard RLS — so there's no compatibility reason to pin older; newer buys a longer runway before a forced major-version upgrade), 1GB Basic plan, same region you'll put the droplet in. Note: self-host's `docker-compose.prod.yml` still pins `postgres:16-alpine` — a follow-up to bump for consistency, not blocking.
2. In the DO panel, note the **admin connection string** (shown as "Connection Details" → "Connection string" — includes `sslmode=require`).
3. Create the database `domi_ops` if it isn't the default.
4. From your local machine (or any box with network access to the cluster — DO lets you allowlist your IP under "Trusted Sources"), **in this exact order**:

   ```bash
   # 1. Run migrations using the admin connection string
   DATABASE_URL="<admin connection string>" npm run db:migrate

   # 2. Pick a real password, then create the RLS-enforced app role (NOBYPASSRLS)
   DOMI_OPS_APP_PASSWORD="<generate — openssl rand -base64 32>" \
     DATABASE_URL="<admin connection string>" npm run db:create-app-role
   ```

   Order matters: step 2 grants `domi_ops_app` read access to schemas/tables that must already exist from step 1 (see next paragraph) — running it first will fail or under-grant.

   **DigitalOcean's `doadmin` is not a true Postgres superuser** — `ALTER ROLE ... [NO]SUPERUSER` (or `[NO]BYPASSRLS`) fails with `permission denied to alter role` even when the value isn't actually changing, because touching those clauses at all requires real superuser. `create-hosted-app-role.mjs` no longer specifies them — omitting a clause reaches the same default (`NOSUPERUSER`/`NOBYPASSRLS`) without hitting that check. Hit and fixed live against a real DO cluster (2026-08-25); `rolsuper: false, rolbypassrls: false, rolcanlogin: true` confirmed after.

5. Build the **app** connection string using the `domi_ops_app` role and the password you just generated, and put it in `.env` as `DATABASE_URL`.

**Why this matters more than it looks like:** the API image's `ENTRYPOINT` runs `migrate.js` **unconditionally on every container boot**, using whatever `DATABASE_URL` is in its env (`apps/api/Dockerfile` — the worker image's `CMD` does not do this, it starts the server directly). Drizzle tracks applied migrations in `"drizzle"."__drizzle_migrations"`, a schema `create-hosted-app-role.mjs` did **not** grant access to until this was caught during setup — fixed now (grants `USAGE` on schema `drizzle` + `SELECT` on its tables).

**That grant turned out not to be enough — confirmed live 2026-08-27:** `migrate.js`'s first statement is an unconditional `CREATE SCHEMA IF NOT EXISTS "drizzle"`, and Postgres permission-checks that against CREATE-on-database *regardless of whether the schema already exists* (this doc previously assumed the check only fired when creation was actually needed — it doesn't). So the restricted `domi_ops_app` role crash-loops on this every single boot, even with nothing pending, and granting it CREATE would defeat the point of the restricted role in the first place (see the "why not just run as admin" note above). The fix is `docker-compose.hosted-prod.yml`'s `api` service overriding the image's `entrypoint:` to skip `migrate.js` and start the server directly — migrations are already a required separate admin-connection-string step for hosted (this doc, step 1 and step 4 below), so the image's auto-migrate was always redundant here, not load-bearing.

**The corollary — an actual operational rule, not a one-time step:** before every deploy that ships new migrations, run `db:migrate` with the **admin** connection string first, then restart the containers. The running app's role can read the migration ledger but cannot apply new DDL — that's intentional (it's the same role serving real requests), not a bug to work around later.

**A migration that adds new tables also needs `create-hosted-app-role.mjs` re-run — confirmed live 2026-08-29:** `domi_ops_app`'s grants are `GRANT ... ON ALL TABLES IN SCHEMA public`, which only covers tables that exist *at the moment the GRANT statement runs* — it is not `ALTER DEFAULT PRIVILEGES`, so it does nothing for tables a later migration creates. This session's medication-groups migration (`0061`/`0062`) shipped without a corresponding re-run, and hosted-prod ran for hours with every `health_medication_groups`/`health_medication_group_members`/etc. query throwing `permission denied for table` (`42501`) — a real customer's first login hit this as a 500 on `/api/health/glance`. Re-running the grant script (same admin-connection, same `docker run --entrypoint node ... create-hosted-app-role.mjs` pattern as the migration step) fixed the grants immediately, confirmed via a direct `information_schema.role_table_grants` query — but the **already-running `api` container kept throwing the identical error** until it was restarted. Whether that's a `postgres.js` client-side pooling behavior or something Postgres-side wasn't tracked down; empirically, `docker restart` (or `--force-recreate`) after the grant is not optional. Order: migrate → grant → restart containers.

**Why not just run the app as the admin role and skip all this?** Table owners (and superusers) bypass Postgres RLS by default regardless of policies, unless a table is explicitly `FORCE ROW LEVEL SECURITY`'d — which these migrations don't do. If the running app connects as admin, every RLS policy from WHO-195/196 (`docs/HOSTED_RLS.md`) becomes a no-op at runtime; API-level household scoping would be the *only* thing preventing a cross-tenant leak, which is exactly the single-point-of-failure RLS was built to back up. `domi_ops_app` is the whole point, not an optional hardening step.

Trusted Sources: once the droplet exists (step 3), add its private/public IP to the Postgres cluster's trusted sources list — don't leave the database open to `0.0.0.0/0`.

**Confirmed 2026-08-25:** `packages/db`'s `postgres.js` connection with no explicit SSL options, relying only on `?sslmode=require` in DO's connection string, works with no TLS/certificate issues — `npm run db:migrate` applied all 58 migrations cleanly against a live DO cluster.

---

## 2. DigitalOcean Spaces (object storage)

1. Create a Space (bucket) — named **`domi-ops-storage`** in **nyc3** (matches `.env.hosted-prod.example`; created 2026-08-25).
2. Generate a Spaces access key + secret (API → Spaces Keys).
3. **Enable CDN** on the Space. Almost nothing in this app is served directly from Spaces — Drive downloads and avatars are proxied through the API (`/api/core/avatars/:memberId`, etc.), so CDN doesn't touch them either way. The one exception is School material uploads (`apps/api/src/routes/school-upload.ts`, `publicObjectUrl()` in `apps/api/src/lib/s3.ts`), which return a direct public Spaces URL — genuinely public, repeat-accessed, and safe to cache since each upload gets a unique timestamped key (no stale-cache risk from re-uploads). CDN is free on top of the existing Spaces plan, so there's no reason not to. DO gives you a CDN-specific endpoint (`https://domi-ops-storage.nyc3.cdn.digitaloceanspaces.com`) — **that** goes in `.env` as `S3_PUBLIC_URL`, not the plain origin endpoint (`S3_ENDPOINT` stays the origin — CDN is edge-cache read-only, not an S3 API surface, so presign/PUT/GET calls still need the real one).
4. CORS: Drive uploads go **browser → S3 directly** via presigned PUT (`packages/db`/API generates the presign; see `docs/SECURITY_REVIEW.md` §4). Add a CORS rule on the Space:
   - Allowed origin: `https://app.domi-ops.com`
   - Allowed methods: `GET`, `PUT`, `HEAD`
   - Allowed headers: `*`
5. Fill `S3_*` vars in `.env` — see `.env.hosted-prod.example` for the exact shape (Spaces uses virtual-hosted-style URLs, so `S3_FORCE_PATH_STYLE=false`, unlike the MinIO self-host default).
6. **Bucket read policy:** leave the Space at **File Listing: Restricted** — don't look for a bucket-wide "Object Access: Public" toggle, DO's current console doesn't have one, and this app doesn't need it. **Corrected 2026-08-25** (the original version of this doc was wrong on two counts): uploads never went through a raw S3 presigned PUT from the browser — the browser PUTs to the Domi Ops API itself (`apps/api/src/routes/browser-upload.ts`, HMAC-signed grant, same-origin, no CORS needed on the Space at all), which then calls S3 server-side. And `putObject()` never set an object ACL, so a bucket-wide public setting wouldn't have made School material links work anyway — the object itself still needed its own ACL. Fixed properly instead: `BrowserUploadGrant.public` (`apps/api/src/lib/upload-token.ts`) flows from `school-upload.ts`'s presign (the only caller that sets it) through to `putObject(..., { public: true })`, which sets `ACL: "public-read"` **per object** on that `PutObjectCommand`. Drive and avatar uploads never set the flag, so they stay private regardless of any bucket-level setting. The CORS rule you already added is harmless but not load-bearing for this — nothing makes a cross-origin browser request to Spaces.

---

## 3. Droplet (compute)

1. Create a droplet — Ubuntu 22.04+, 2GB/1vCPU (Basic), same region as Postgres/Spaces to keep latency and egress low.
2. Install Docker Engine + Compose plugin ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)).
3. Generate a deploy-key keypair **on the droplet** and register the public half as a read-only
   GitHub deploy key, then clone:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/domi_ops_deploy -N "" -C "domi-ops-hosted-droplet-readonly"
   cat ~/.ssh/domi_ops_deploy.pub   # add via: gh repo deploy-key add - --repo <owner>/domi-ops --title hosted-droplet

   cat >> ~/.ssh/config <<'CFG'
   Host github.com
     IdentityFile ~/.ssh/domi_ops_deploy
     IdentitiesOnly yes
   CFG

   git clone git@github.com:<owner>/domi-ops.git ~/domi-ops
   ```

   Then drop `.env` (filled from `.env.hosted-prod.example`) and `Caddyfile`
   (from `deploy/Caddyfile.domi-ops.example`) into `~/domi-ops` — both are `.gitignore`d, stay
   droplet-only, and survive every future `git pull`.
4. Log in to GHCR and pull:

   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
   export DOMI_OPS_IMAGE_TAG=latest
   docker compose -f docker-compose.hosted-prod.yml -f docker-compose.marketing.yml pull
   docker compose -f docker-compose.hosted-prod.yml -f docker-compose.marketing.yml up -d --no-build
   ```

5. Check logs for clean boot (`docker compose logs api worker web www --tail 50`). `docker-compose.hosted-prod.yml`'s `api` service overrides the image's entrypoint to skip `migrate.js` (see step 1's note) — it should go straight to a normal server-start log line, no migration output at all. `worker` should come up clean too (needs `API_URL` — already set in the compose file). If either crash-loops, `docker compose logs <service>` first; a permission error means step 1's order was wrong (migrate as admin, *then* create the app role) — don't work around it by pointing `DATABASE_URL` at the admin role, see the "why not just run as admin" note in step 1.

For every deploy after this first stand-up, use `deploy/deploy-hosted.sh` (from `~/domi-ops`) —
it does the `git pull` + `docker compose pull` + `up` + health-check sequence above in one step.
See [HOSTED_OPS.md](./HOSTED_OPS.md#routine-updates).

---

## 4. Caddy (reverse proxy / TLS)

Caddy is **not** a service in `docker-compose.hosted-prod.yml` — same pattern as `docker-compose.prod.yml` (see its header comment). Run Caddy separately, joined to the `domi_ops_proxy` network so it can `reverse_proxy` the `domiops-web` / `domiops-www` containers by name.

Use [`Caddyfile.domi-ops.example`](./Caddyfile.domi-ops.example) **with one change**: delete the `/s3/*` → `minio:9000` proxy block in the `app.domi-ops.com` and `demo.domi-ops.com` stanzas. There's no `minio` container in this stack — Drive files are served directly from DO Spaces via `S3_PUBLIC_URL`, no proxy path needed.

```bash
docker run -d --name caddy --restart unless-stopped \
  --network domi_ops_proxy \
  -p 80:80 -p 443:443 \
  -v $(pwd)/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  caddy:2-alpine
```

**After editing `Caddyfile`, use `docker restart caddy`, not `docker exec caddy caddy reload`.**
Confirmed live (2026-08-27): `caddy reload` printed a clean "adapted config to JSON" with no
errors, but the change (a `handle /health` block) never actually took effect — querying the
admin API (`docker exec caddy wget -qO- http://127.0.0.1:2019/config/apps/http/servers`) showed
the *old* routes still loaded. A full `docker restart caddy` picked up the same file correctly.
Never got to the bottom of why `reload` no-ops here; `restart` is a few seconds of TLS
handshake disruption for in-flight connections, not worth chasing further for how rarely this
file changes.

Also: within one site block, don't mix a bare top-level `reverse_proxy` with a `handle {}`
block for a different path — Caddy's automatic directive ordering doesn't reliably interleave
them. Use two `handle` blocks instead (one path-matched, one bare as the catch-all) — see
`Caddyfile.domi-ops.example`'s `app.domi-ops.com` stanza for the pattern.

---

## 5. DNS cutover

Follow [docs/marketing/DNS_CUTOVER.md](../docs/marketing/DNS_CUTOVER.md) as written — apex → this droplet (marketing), `app.` → this droplet (application). One addition for the beta specifically: **keep the dogfood `whome.whobrey.me` DNS untouched** — that's a separate single-tenant instance and this work doesn't affect it.

---

## 6. Stripe — live mode

Follow [docs/marketing/STRIPE_SETUP.md](../docs/marketing/STRIPE_SETUP.md) for the Product/Price/webhook checklist, plus for this beta specifically:

1. Create a **100% off, once-forever coupon** in Stripe Dashboard → Coupons (duration: `forever` if he keeps the household long-term, or `repeating` for a fixed number of months if you'd rather cap it).
2. Create a **Promotion Code** attached to that coupon (e.g. `BETATESTER`) — this is the code the tester actually types at checkout, not the coupon ID.
3. Webhook endpoint: `https://app.domi-ops.com/api/billing/webhook`, events per STRIPE_SETUP.md.

**Engineering side is built** (2026-08-24) — `POST /api/billing/checkout` creates the Checkout Session (`allow_promotion_codes: true`, so the tester's code works), the pricing page posts to it via a plain HTML form (no client JS), and the post-checkout return flow (`/setup?session_id=...` → validate → complete → dashboard) was already in place. Both are inert until env flags are flipped — nothing to redeploy, just set and restart:

- API `.env`: `STRIPE_*` keys/price IDs (this doc §6).
- Marketing `.env` (same file, read by `docker-compose.marketing.yml`): `NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED=true` once Stripe is live and smoke-tested; `NEXT_PUBLIC_OSS_REPO_PUBLIC=true` only after the separate WHO-174 repo flip.

Test the full loop against **Stripe test mode** first (`sk_test_...` keys, flag on) before flipping to live keys.

---

## 7. Smoke test (do this before inviting the beta tester)

1. `curl https://app.domi-ops.com/health` (or `/api/health`) → `ok`.
2. `https://domi-ops.com` loads; pricing page shows live checkout CTA (once the endpoint above ships).
3. Full dry run in **Stripe test mode** first: pricing → checkout with a test card + your promo code → webhook fires → household appears in DO Postgres → `/hosted-setup` wizard → dashboard.
4. Only after the test-mode run is clean, swap `.env` to live Stripe keys and repeat once for real with the real promo code.
5. Confirm `/setup`-style public owner sign-up is still blocked: `curl -X POST https://app.domi-ops.com/api/auth/sign-up/email` → `403` (WHO-248 guard — should already hold, this just confirms it wasn't accidentally loosened).
6. **Google path (WHO-277/279):** on `/login`, "Continue with Google" *before* any checkout must land on `domi-ops.com/pricing` with a "finish setup" notice — **not** a blank screen. Then run checkout with that same Google email → `/setup?session_id=` wizard → completes → `/dashboard`. Also verify the reverse order (checkout with email/password first, then "Continue with Google" same address → links, lands on dashboard). Both against Stripe test mode first.

---

## Ongoing ops

Once this is live, day-2 operations (monitoring, backups, incident response, capacity signals) are already documented — this doc only covers first stand-up: [deploy/HOSTED_OPS.md](./HOSTED_OPS.md).
