# Hosted Starter — private beta setup (real production infra)

Provisioning runbook for the **private beta** decided in [.cursor/runbook/07_LAUNCH.md](../.cursor/runbook/07_LAUNCH.md) — `app.domi-ops.com` and `domi-ops.com` go live for real, ahead of the OSS repo flip, so one invited tester (Kort) can go through the actual marketing → checkout → onboarding path. Architecture is [ADR 003](../docs/adr/003-hosted-db-architecture.md) as signed off, not a scaled-down version — this becomes the real Hosted Starter production environment, not throwaway.

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
- [ ] CI publishing images to GHCR on `master` — already true ([publish-images.yml](../.github/workflows/publish-images.yml))

You do **not** need to `git clone` the private repo onto the droplet — pull pre-built GHCR images and copy just the compose files + `.env` over. Simpler and matches the Path C pattern you already use for the dogfood box.

---

## 1. DigitalOcean Managed Postgres

1. Create a cluster: **Postgres 16**, 1GB Basic plan, same region you'll put the droplet in.
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

5. Build the **app** connection string using the `domi_ops_app` role and the password you just generated, and put it in `.env` as `DATABASE_URL`.

**Why this matters more than it looks like:** the API/worker Docker image's `ENTRYPOINT` runs `migrate.js` **unconditionally on every container boot**, using whatever `DATABASE_URL` is in its env — this isn't a self-host-only behavior, it's baked into the image (`apps/api/Dockerfile` / `apps/worker/Dockerfile`). That means the *running app* — connected as the restricted `domi_ops_app` role, precisely so RLS actually protects something at runtime — will also try to run the migrator on every restart. Drizzle tracks applied migrations in `"drizzle"."__drizzle_migrations"`, a schema `create-hosted-app-role.mjs` did **not** grant access to until this was caught during setup — fixed now (grants `USAGE` on schema `drizzle` + `SELECT` on its tables), so a fully-migrated boot just sees "nothing pending" and starts normally instead of failing closed on a permission error before the app ever comes up.

**The corollary — an actual operational rule, not a one-time step:** before every deploy that ships new migrations, run `db:migrate` with the **admin** connection string first, then restart the containers. The running app's role can read the migration ledger but cannot apply new DDL — that's intentional (it's the same role serving real requests), not a bug to work around later.

**Why not just run the app as the admin role and skip all this?** Table owners (and superusers) bypass Postgres RLS by default regardless of policies, unless a table is explicitly `FORCE ROW LEVEL SECURITY`'d — which these migrations don't do. If the running app connects as admin, every RLS policy from WHO-195/196 (`docs/HOSTED_RLS.md`) becomes a no-op at runtime; API-level household scoping would be the *only* thing preventing a cross-tenant leak, which is exactly the single-point-of-failure RLS was built to back up. `domi_ops_app` is the whole point, not an optional hardening step.

Trusted Sources: once the droplet exists (step 3), add its private/public IP to the Postgres cluster's trusted sources list — don't leave the database open to `0.0.0.0/0`.

**Untested here, flagging rather than guessing:** `packages/db` connects via `postgres.js` with no explicit SSL options — it relies entirely on `?sslmode=require` in the connection string DO gives you. This is very likely fine (DO's cert chain is publicly trusted, postgres.js honors `sslmode` in the URL), but neither this repo nor this session has actually connected to a DO Managed Postgres instance. If `db:migrate` / `db:create-app-role` fail with a TLS/certificate error, that's the first place to look — not something to debug blind in a doc.

---

## 2. DigitalOcean Spaces (object storage)

1. Create a Space (bucket) — e.g. `domi-ops-hosted`, same region as the droplet.
2. Generate a Spaces access key + secret (API → Spaces Keys).
3. CORS: Drive uploads go **browser → S3 directly** via presigned PUT (`packages/db`/API generates the presign; see `docs/SECURITY_REVIEW.md` §4). Add a CORS rule on the Space:
   - Allowed origin: `https://app.domi-ops.com`
   - Allowed methods: `GET`, `PUT`, `HEAD`
   - Allowed headers: `*`
4. Fill `S3_*` vars in `.env` — see `.env.hosted-prod.example` for the exact shape (Spaces uses virtual-hosted-style URLs, so `S3_FORCE_PATH_STYLE=false`, unlike the MinIO self-host default).
5. **Bucket read policy:** most Drive files stay private (served through authenticated API proxy routes — Drive downloads, avatars). But `publicObjectUrl()` (`apps/api/src/lib/s3.ts`) builds a direct-to-Spaces URL for School material links (`apps/api/src/routes/school-upload.ts`), which needs those specific object keys publicly readable. Simplest: set the Space itself to **public read** at creation (DO's "File Listing: Restricted, Object Access: Public" option) — this matches what self-host MinIO already does today (unauthenticated bucket, only reachable through Caddy's `/s3/*` block, not exposed on the open internet). Don't rely on per-object ACLs; they're easy to get wrong per-upload.

---

## 3. Droplet (compute)

1. Create a droplet — Ubuntu 22.04+, 2GB/1vCPU (Basic), same region as Postgres/Spaces to keep latency and egress low.
2. Install Docker Engine + Compose plugin ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)).
3. Copy these files to the droplet (`scp` or paste — no repo clone needed):
   - `docker-compose.hosted-prod.yml`
   - `docker-compose.marketing.yml`
   - `.env` (filled from `.env.hosted-prod.example`)
4. Log in to GHCR and pull:

   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
   export DOMI_OPS_IMAGE_TAG=latest
   docker compose -f docker-compose.hosted-prod.yml -f docker-compose.marketing.yml pull
   docker compose -f docker-compose.hosted-prod.yml -f docker-compose.marketing.yml up -d --no-build
   ```

5. Check logs for clean boot (`docker compose logs api worker web www --tail 50`). The API/worker entrypoint **does** still run `migrate.js` on boot (same image as self-host) — with everything already applied via step 1 and `domi_ops_app` granted read access to the migration ledger, it should log `Applying database migrations...` followed by no pending migrations, then start normally. If it instead fails with a permission error here, stop and re-check step 1's order (migrate as admin, *then* create the app role) before doing anything else — don't work around it by pointing `DATABASE_URL` at the admin role, see the "why not just run as admin" note in step 1.

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

---

## 5. DNS cutover

Follow [docs/marketing/DNS_CUTOVER.md](../docs/marketing/DNS_CUTOVER.md) as written — apex → this droplet (marketing), `app.` → this droplet (application). One addition for the beta specifically: **keep the dogfood `whome.whobrey.me` DNS untouched** — that's a separate single-tenant instance and this work doesn't affect it.

---

## 6. Stripe — live mode

Follow [docs/marketing/STRIPE_SETUP.md](../docs/marketing/STRIPE_SETUP.md) for the Product/Price/webhook checklist, plus for this beta specifically:

1. Create a **100% off, once-forever coupon** in Stripe Dashboard → Coupons (duration: `forever` if he keeps the household long-term, or `repeating` for a fixed number of months if you'd rather cap it).
2. Create a **Promotion Code** attached to that coupon (e.g. `KORTBETA`) — this is the code Kort actually types at checkout, not the coupon ID.
3. Webhook endpoint: `https://app.domi-ops.com/api/billing/webhook`, events per STRIPE_SETUP.md.

**Engineering side is built** (2026-08-24) — `POST /api/billing/checkout` creates the Checkout Session (`allow_promotion_codes: true`, so Kort's code works), the pricing page posts to it via a plain HTML form (no client JS), and the post-checkout return flow (`/setup?session_id=...` → validate → complete → dashboard) was already in place. Both are inert until env flags are flipped — nothing to redeploy, just set and restart:

- API `.env`: `STRIPE_*` keys/price IDs (this doc §6).
- Marketing `.env` (same file, read by `docker-compose.marketing.yml`): `NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED=true` once Stripe is live and smoke-tested; `NEXT_PUBLIC_OSS_REPO_PUBLIC=true` only after the separate WHO-174 repo flip.

Test the full loop against **Stripe test mode** first (`sk_test_...` keys, flag on) before flipping to live keys.

---

## 7. Smoke test (do this before inviting Kort)

1. `curl https://app.domi-ops.com/health` (or `/api/health`) → `ok`.
2. `https://domi-ops.com` loads; pricing page shows live checkout CTA (once the endpoint above ships).
3. Full dry run in **Stripe test mode** first: pricing → checkout with a test card + your promo code → webhook fires → household appears in DO Postgres → `/hosted-setup` wizard → dashboard.
4. Only after the test-mode run is clean, swap `.env` to live Stripe keys and repeat once for real with the real promo code.
5. Confirm `/setup`-style public owner sign-up is still blocked: `curl -X POST https://app.domi-ops.com/api/auth/sign-up/email` → `403` (WHO-248 guard — should already hold, this just confirms it wasn't accidentally loosened).

---

## Ongoing ops

Once this is live, day-2 operations (monitoring, backups, incident response, capacity signals) are already documented — this doc only covers first stand-up: [deploy/HOSTED_OPS.md](./HOSTED_OPS.md).
