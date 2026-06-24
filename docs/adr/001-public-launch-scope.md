# ADR 001: Public launch scope (OSS + hosted v1)

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-06-23 |
| **Linear** | [WHO-171](https://linear.app/mikewhob-whome/issue/WHO-171) |
| **Related** | [WHO-189](https://linear.app/mikewhob-whome/issue/WHO-189) (brand), [WHO-183](https://linear.app/mikewhob-whome/issue/WHO-183) (site topology), [WHO-177](https://linear.app/mikewhob-whome/issue/WHO-177) (hosted DB spike) |

## Context

The product (internal repo name **whome**) is dogfooded on self-host at a private deployment. `/` redirects unauthenticated visitors to `/login`; public sign-up is disabled in production (`ALLOW_PUBLIC_SIGNUP=false`). Private GHCR images ship via CI ([WHO-133](https://linear.app/mikewhob-whome/issue/WHO-133)).

**Public launch** means releasing **open source self-host and Domi Ops hosted tiers on the same day** — not a staged “OSS first, cloud later” rollout. Until launch, the GitHub repo and container images stay **private**.

The codebase already has household module toggles (`modulesEnabled`), a deploy catalog (`MODULES_ENABLED`), Drive quota columns on `households`, and a `deployment_tier` enum — but hosted multi-tenant isolation (RLS / per-household DB routing) is **not implemented**. Entitlements must be designed **before** hosted engineering, not bolted on after launch.

## Decision summary

1. **Launch gate:** Private repo until OSS + hosted are both ready ([WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187) go/no-go).
2. **Brand:** **Domi Ops** (styling `DomiOps` in code acceptable). Domain **`domi-ops.com`**; app at **`app.domi-ops.com`**.
3. **Topology:** Marketing on apex; application on `app.` subdomain ([WHO-183](https://linear.app/mikewhob-whome/issue/WHO-183)).
4. **Tiers:** Hosted **Starter** (shared Postgres + RLS) and **Family** (dedicated DB per household, e.g. Neon) are **v1 product targets**; implementation details in [WHO-177](https://linear.app/mikewhob-whome/issue/WHO-177).
5. **Modules:** Full module bundle in **OSS self-host** (no paywalled code in the public repo). **Hosted** monetizes via **subscription entitlements** (module bundles + storage quotas), not by removing modules from OSS.
6. **Drive quotas:** **Required at hosted launch** — hard enforcement, not Phase 2.
7. **Onboarding:** Self-host uses deliberate bootstrap ([WHO-176](https://linear.app/mikewhob-whome/issue/WHO-176)); hosted uses **Stripe checkout → webhook provision → setup wizard** ([WHO-179](https://linear.app/mikewhob-whome/issue/WHO-179), [WHO-184](https://linear.app/mikewhob-whome/issue/WHO-184)).
8. **Payments:** **Stripe** (existing account). SKU matrix, trials, and pricing deferred until pre-test ([WHO-185](https://linear.app/mikewhob-whome/issue/WHO-185)).
9. **Legal:** Privacy / terms revisited immediately pre-launch ([WHO-182](https://linear.app/mikewhob-whome/issue/WHO-182)).
10. **Internal rename:** npm scope `@whome/*`, GHCR `whome-*`, and repo name may stay until launch; **customer-facing** surfaces use Domi Ops.

---

## Brand & domains

| Surface | URL | Purpose |
|---------|-----|---------|
| Marketing | `https://domi-ops.com` | Landing, pricing, docs links, hosted CTAs ([WHO-134](https://linear.app/mikewhob-whome/issue/WHO-134)) |
| Application | `https://app.domi-ops.com` | Auth, dashboard, all modules |
| Self-host docs | GitHub README / `docs/SETUP.md` | Linked from marketing; no separate product domain required |

**Cookie rule:** Session cookies are scoped to `app.domi-ops.com` only. The marketing site does not set auth cookies.

**Environment:** Hosted production sets `PUBLIC_APP_URL=https://app.domi-ops.com`.

---

## Deployment modes

Maps to existing `DEPLOYMENT_MODE` env and `households.tier` enum.

| Mode | `DEPLOYMENT_MODE` | `households.tier` | Database | Audience |
|------|-------------------|-------------------|----------|----------|
| **OSS self-host** | `single` | `self_host` | Operator’s Postgres (one household per instance) | Families running Docker on their own server |
| **Hosted Starter** | `shared` | `hosted_starter` | Shared Postgres + **RLS** | Entry hosted tier |
| **Hosted Family** | `dedicated` (per household connection) | `hosted_dedicated` | Dedicated Postgres (e.g. Neon project per household) | Higher isolation / scale tier |

**Self-host invariant:** One Postgres instance serves one household. No RLS required; household scoping in API is still mandatory for consistency and future portability.

**Hosted invariant:** Cross-household data leakage must be impossible (RLS and/or dedicated DB — see WHO-177).

---

## Module catalog

Authoritative list: `KNOWN_HOUSEHOLD_MODULES` in `@whome/config`:

| Module | Scope |
|--------|--------|
| `core` | Dashboard, shopping, chores, notes, expenses — always on |
| `school` | Homeschool LMS |
| `calendar_sync` | Google Calendar OAuth + worker sync |
| `drive` | Household file storage (MinIO/S3) |
| `health` | Health tracker (encrypted fields) |

New modules added to the monorepo are included in the **OSS bundle** and follow the same **hosted entitlement** rules as `school` (not special-cased unless product explicitly decides otherwise).

### Self-host (OSS)

- All modules in `MODULES_ENABLED` deploy catalog are available.
- Owner toggles `modulesEnabled` in Settings (subset of deploy catalog).
- `storage_quota_bytes = NULL` → **unlimited** Drive storage.
- No Stripe; no `modules_entitled` ceiling.

### Hosted

- **`modules_entitled`** — subscription-granted module set (ceiling).
- **`modules_enabled`** — owner toggles within ceiling (existing Settings UI).
- **Rule:** `modules_enabled ⊆ modules_entitled ⊆ KNOWN_HOUSEHOLD_MODULES`.
- Non-core modules (`school`, `calendar_sync`, `drive`, `health`) may be bundled in base tier or sold as add-on SKUs — **TBD in WHO-185**; architecture must support either.
- **`drive` is always present on hosted** but **quota-tiered** (not module-gated off). Upload blocked at cap; usage meter in Settings.

---

## Entitlements model (day 1)

Hosted launch requires a subscription layer above existing module toggles.

```
Stripe subscription
  → webhook updates household + subscription row
      → tier                  (hosted_starter | hosted_dedicated)
      → modules_entitled[]    (JSON array, synced from SKU)
      → storage_quota_bytes   (required, non-null on hosted)
      → stripe_customer_id / stripe_subscription_id
  → owner adjusts modules_enabled in /settings (within entitled set)
```

**Schema direction** ([WHO-178](https://linear.app/mikewhob-whome/issue/WHO-178)):

- Extend `households` and/or add `household_subscriptions` table.
- Reuse existing `storage_quota_bytes`, `storage_used_bytes` on `households`.
- API enforces entitlements on module routes and Drive upload.
- Nav gating (web) already hides modules not in `modulesEnabled`; extend to respect `modules_entitled` on hosted.

**No per-tier code forks.** Same API routes and UI; checks at boundaries.

---

## Monetization principles

| Principle | Decision |
|-----------|----------|
| OSS module code | **Public, complete** — do not privatize modules in the repo for revenue |
| Self-host price | **Free** (MIT) |
| Hosted revenue | Tier subscriptions + optional module add-ons + **storage quota tiers** |
| Drive on self-host | Unlimited (`quota = NULL`) |
| Drive on hosted | **Enforced quota at launch** |

---

## Onboarding flows

### Self-host (OSS)

1. Operator deploys Docker Compose (private GHCR until launch, then public).
2. **Greenfield:** [WHO-176](https://linear.app/mikewhob-whome/issue/WHO-176) setup token or CLI — **not** public `/auth/sign-up`.
3. **Migration:** HomeHub import + Google claim (existing paths).
4. `ALLOW_PUBLIC_SIGNUP=false` remains production default.

### Hosted (Domi Ops cloud)

1. User selects tier on `domi-ops.com` pricing → **Stripe Checkout**.
2. Stripe webhook creates household, sets entitlements, stubs owner.
3. Redirect to **`app.domi-ops.com`** setup wizard ([WHO-184](https://linear.app/mikewhob-whome/issue/WHO-184)): household name, timezone, module toggles (within entitled).
4. Owner completes auth (password / Google) if not finished in checkout.
5. No open public owner sign-up on hosted apex.

---

## Launch readiness (what “ready” means)

Both tracks must pass [WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187) before the public flip:

| Track | Minimum bar |
|-------|-------------|
| **OSS** | [WHO-172](https://linear.app/mikewhob-whome/issue/WHO-172) security review; [WHO-176](https://linear.app/mikewhob-whome/issue/WHO-176) bootstrap; [WHO-175](https://linear.app/mikewhob-whome/issue/WHO-175) stranger docs; [WHO-174](https://linear.app/mikewhob-whome/issue/WHO-174) public repo + GHCR |
| **Hosted** | [WHO-178](https://linear.app/mikewhob-whome/issue/WHO-178) tenant isolation; [WHO-179](https://linear.app/mikewhob-whome/issue/WHO-179) provisioning; [WHO-186](https://linear.app/mikewhob-whome/issue/WHO-186) quota + module enforcement; [WHO-180](https://linear.app/mikewhob-whome/issue/WHO-180) ops runbook |
| **Public web** | [WHO-134](https://linear.app/mikewhob-whome/issue/WHO-134) landing; [WHO-181](https://linear.app/mikewhob-whome/issue/WHO-181) pricing; legal pages pre-launch |
| **Community** | [WHO-188](https://linear.app/mikewhob-whome/issue/WHO-188) issue templates |

---

## In scope for v1 launch

- Domi Ops brand on `domi-ops.com` / `app.domi-ops.com`
- OSS self-host (Docker, public repo, public GHCR) **same day** as hosted
- Hosted Starter (shared + RLS) **at minimum**
- Hosted Family (dedicated DB) — **product target**; if engineering risk is high, ship Starter first only with schema/UI ready for Family upgrade (final call after WHO-177 spike)
- Full OSS module bundle
- Hosted entitlements + Drive quota enforcement
- Stripe provisioning + setup wizard
- Self-host bootstrap without public sign-up

## Explicitly deferred (post-launch or pre-test planning only)

- Stripe SKU matrix, trial length, card-up-front policy ([WHO-185](https://linear.app/mikewhob-whome/issue/WHO-185))
- Final legal copy ([WHO-182](https://linear.app/mikewhob-whome/issue/WHO-182))
- Package/repo rename `@whome` → `@domiops` (optional; cosmetic for v1)
- Community Discord (decide in [WHO-188](https://linear.app/mikewhob-whome/issue/WHO-188))
- Trademark filing (optional quick screen only)

---

## Open questions (resolve before implementation spikes complete)

| # | Question | Owner | Blocking |
|---|----------|-------|----------|
| 1 | Starter-only vs Starter+Family on launch day | Mike + WHO-177 | WHO-178, pricing copy |
| 2 | Base tier module bundle vs à-la-carte add-ons | Mike + WHO-185 | Stripe products, WHO-181 |
| 3 | Default hosted storage quotas per tier (e.g. 10 GB / 50 GB / 100 GB) | Mike + WHO-185 | WHO-186 |
| 4 | `apps/www` vs static marketing on apex | WHO-183 ADR | WHO-134 implementation |
| 5 | Email verification required on hosted? ([WHO-89](https://linear.app/mikewhob-whome/issue/WHO-89)) | Mike | WHO-184 |

---

## Consequences

### Positive

- Single launch moment; no confused “half-open” OSS story.
- Entitlements schema early avoids hosted rework.
- Clear separation: marketing domain vs app domain.
- OSS community gets full module source; hosted revenue stays clean.

### Negative / cost

- Launch blocked on **both** OSS polish and hosted platform (longer calendar).
- Brand transition: internal `whome` vs external Domi Ops until rename.
- RLS or multi-DB routing is significant engineering ([WHO-178](https://linear.app/mikewhob-whome/issue/WHO-178)).

### Follow-up ADRs / docs

| Doc | Issue |
|-----|-------|
| Marketing site topology + Caddy | [WHO-183](https://linear.app/mikewhob-whome/issue/WHO-183) |
| Hosted DB architecture (RLS vs Neon) | [WHO-177](https://linear.app/mikewhob-whome/issue/WHO-177) |
| Launch checklist | [WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187) |

Update `docs/ARCHITECTURE.md` module list and brand reference when implementation begins (keep ADR as launch source of truth until then).
