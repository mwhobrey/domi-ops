# Pre-launch security review

**Issue:** [WHO-172](https://linear.app/mikewhob-whome/issue/WHO-172)  
**Scope:** Self-host OSS launch gate (`DEPLOYMENT_MODE=single`). Hosted multi-tenant (`shared` / RLS) foundation shipped in M3 (WHO-195–198) — section 8 updated; Stripe provisioning still M5.  
**Reviewed:** 2026-07-08 · commit after WHO-176; hosted section refreshed after M3  
**Method:** Code + config audit, `npm audit`, Docker/compose review. No penetration test.

## Summary

| Area | Result | Notes |
|------|--------|-------|
| Auth & sessions | **Pass** | Public sign-up off by default; setup token for greenfield; OAuth state in Redis |
| Secrets & config | **Pass** | Zod production guards; `.env` not in images; `.env.example` documented |
| API household scoping | **Pass** | Routes use `auth.householdId`; admin guards on settings/members |
| Uploads & Drive | **Partial** | Size caps + HMAC upload tokens; no MIME allowlist; public shares opt-out |
| Health module | **Pass** | Field encryption + visibility/shares; prod requires `ENCRYPTION_KEY` |
| Dependencies | **Partial** | 1 high (`nodemailer`), 6 moderate (esbuild chain, postcss via Next) |
| Docker hardening | **Partial** | Internal network, no host DB ports; **containers run as root** |
| Hosted tenant isolation | **Partial** | RLS + tenant context shipped (M3); run `npm run test:hosted` after seed |

**Verdict:** Acceptable for **private self-host OSS** launch with documented gaps. Address **Partial** items before public repo flip (WHO-174) or any hosted multi-tenant work.

---

## 1. Authentication & sessions

| Check | Status | Evidence |
|-------|--------|----------|
| Public owner sign-up disabled in production | **Pass** | `ALLOW_PUBLIC_SIGNUP` defaults off in production (`packages/config`); API blocks `/auth/sign-up/*` unless demo, public signup, or greenfield setup grant (`apps/api/src/index.ts`) |
| Greenfield bootstrap without public signup | **Pass** | WHO-176: `SETUP_TOKEN` + `/setup` grant cookie; timing-safe compare (`packages/auth/src/setup.ts`) |
| Session cookies HTTP-only / secure | **Pass** | Better Auth manages session cookies; setup grant uses `httpOnly`, `secure` in production, `sameSite: Lax` (`apps/api/src/routes/setup.ts`) |
| CSRF on state-changing browser flows | **Pass** | Better Auth + `sameSite: Lax` cookies; OAuth uses one-time state in Redis |
| OAuth state (Google login + calendar) | **Pass** | `randomOAuthState()` + Redis `oauth:calendar:*` with 10m TTL; `consumeOAuthState` deletes after use (`apps/api/src/lib/oauth-state.ts`, `google-calendar-auth.ts`) |
| Dev auth bypass documented | **Pass** | `requireAuth` skips when `!AUTH_REQUIRED && NODE_ENV=development`; web middleware allows through on session fetch failure in dev only (runbook `03`) |
| Trusted origins | **Pass** | Better Auth `trustedOrigins`: production = `PUBLIC_APP_URL` only; dev adds loopback variants (`packages/auth/src/better-auth.ts`) |

**Follow-up:** None blocking self-host.

---

## 2. Secrets & configuration

| Check | Status | Evidence |
|-------|--------|----------|
| `.env` not committed | **Pass** | `.gitignore` excludes `.env` |
| Production boot guards | **Pass** | `loadEnv()` `superRefine`: `SESSION_SECRET` ≥32, `ENCRYPTION_KEY`, `AUTH_REQUIRED`, Google creds when `calendar_sync` enabled, `ENCRYPTION_KEY` when `health` enabled (`packages/config/src/index.ts`) |
| `.env.example` completeness | **Pass** | Core, DB, Redis, S3, modules, Drive, VAPID, SMTP, `SETUP_TOKEN`, demo flags documented |
| Secrets baked into images | **Pass** | Dockerfiles copy built artifacts only; runtime reads `env_file: .env` on compose |
| Default dev secrets | **Pass** | Placeholder values in `.env.example`; production compose requires `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |

**Follow-up:** Add `POSTGRES_PASSWORD` to `.env.example` comment for prod compose (WHO-175).

---

## 3. API authorization & household scoping

| Check | Status | Evidence |
|-------|--------|----------|
| Authenticated routes use `requireAuth` | **Pass** | `core`, `calendar`, `drive`, `school`, `health`, `weekly-reports`, etc. mount `requireAuth` |
| Queries scoped by `householdId` | **Pass** | e.g. `eq(notices.householdId, auth.householdId)` throughout `apps/api/src/routes/core.ts` |
| Module gating | **Pass** | `requireHouseholdModule` / `isHouseholdModuleEnabled` on school, drive, health, calendar |
| Owner/admin boundaries | **Pass** | `canProvisionMembers` on settings + member role PATCH; `updateHouseholdMemberRole` last-owner guard (`packages/auth`) |
| School / health visibility | **Pass** | Role + enrollment checks (`school-access.ts`); health private + share lists (`health-access.ts`) |
| Setup routes unauthenticated | **Pass** | Intentional; token required for unlock; closes after household exists |
| Public Drive shares | **Pass** | `/s/:token` gated by `DRIVE_PUBLIC_SHARES_ENABLED`; optional password hash |

**Follow-up:** No automated test suite for IDOR — manual QA + future E2E (see Testing).

---

## 4. File upload & Drive

| Check | Status | Evidence |
|-------|--------|----------|
| Upload size limits | **Pass** | `DRIVE_UPLOAD_MAX_BYTES` enforced on presign + browser PUT (`drive.ts`, `browser-upload.ts`) |
| Upload authorization | **Pass** | HMAC-signed `BrowserUploadGrant` binds `householdId`, `memberId`, `key`, `maxBytes`, expiry (`upload-token.ts`) |
| Path traversal on S3 keys | **Pass** | Keys generated server-side (`drive/` prefix + UUID); clients cannot pick arbitrary paths on presign |
| MIME / content-type validation | **Partial** | Client-supplied `contentType` stored and served; no allowlist/blocklist for executables |
| Public share link abuse | **Partial** | Unguessable tokens; disable via `DRIVE_PUBLIC_SHARES_ENABLED=false`; no rate limit on `/s/:token` |
| Avatar uploads | **Pass** | API resizes to WebP 256²; separate from Drive presign flow |

**Recommended follow-up issues:**

- MIME allowlist or `Content-Disposition: attachment` for risky types on Drive proxy download
- Rate limit public share endpoint if enabled

---

## 5. Health module (PHI-like data)

| Check | Status | Evidence |
|-------|--------|----------|
| Encryption at rest | **Pass** | `encryptHealthField` / `decryptHealthField` via `@domi-ops/crypto` + `ENCRYPTION_KEY` (`health-crypto.ts`) |
| Prod key required | **Pass** | Config `superRefine` when `health` ∈ `MODULES_ENABLED` |
| Access control | **Pass** | `healthEventVisibleWhere` / `healthMedicationVisibleWhere`: household \| subject (`memberId`) \| creator \| explicit shares. **No admin override** on list/reports/overlays. New rows default **private** (WHO-226). |
| HIPAA claim | **Pass** | Documented as **not** HIPAA-compliant in `SELF_HOST.md` |

**Follow-up:** `ENCRYPTION_KEY` rotation tooling still absent (documented limitation).

---

## 6. Dependencies

`npm audit` (2026-07-08):

| Severity | Count | Package | Notes |
|----------|-------|---------|-------|
| High | 1 | `nodemailer` ≤9.0.0 | SSRF/file-read in raw message option — only used for optional SMTP verification email |
| Moderate | 6 | `esbuild` (via `drizzle-kit`), `postcss` (via `next`) | Dev/build-time; not runtime API surface |

**Recommended follow-up:** Bump `nodemailer` to `^9.0.3` in `@domi-ops/auth` before public launch.

CI runs `npm audit` implicitly via install; consider explicit `npm audit --audit-level=high` in CI after nodemailer bump.

---

## 7. Docker & production compose

| Check | Status | Evidence |
|-------|--------|----------|
| DB/Redis/MinIO not on public ports | **Pass** | `docker-compose.prod.yml` — internal network only |
| Required secrets at compose up | **Pass** | `${POSTGRES_PASSWORD:?}`, `${S3_ACCESS_KEY:?}`, `${S3_SECRET_KEY:?}` |
| Healthchecks on postgres/redis | **Pass** | Compose healthchecks; API `depends_on: service_healthy` |
| Non-root container user | **Fail** | `apps/api`, `apps/web`, `apps/worker` Dockerfiles — no `USER` directive; run as root in Alpine |
| Read-only root filesystem | **N/A** | Not configured |
| Resource limits | **N/A** | Not set in compose (operator concern) |

**Recommended follow-up:** Add non-root `USER node` (or distroless) to production Dockerfiles.

---

## 8. Hosted multi-tenant (M3 foundation)

| Check | Status | Evidence |
|-------|--------|----------|
| Row-level security | **Pass** | Migrations `0038`/`0039`; `docs/HOSTED_RLS.md` |
| Per-request tenant context | **Pass** | `withHouseholdContext`, API tenant middleware, worker contexts (WHO-196) |
| Cross-tenant IDOR tests | **Partial** | `npm run test:hosted` + `docs/HOSTED_TENANT_TESTS.md` (requires Postgres seed) |
| Entitlements ceiling | **Pass** | `household_subscriptions.modules_entitled` enforced in settings + session (WHO-178) |
| Stripe / provisioning | **N/A** | M5 (WHO-185/199) |

Re-run full matrix on staging with `DEPLOYMENT_MODE=shared` before hosted launch (WHO-187).

---

## 9. Testing & monitoring

| Check | Status | Evidence |
|-------|--------|----------|
| Unit tests for auth/setup crypto | **Pass** | `packages/auth/src/setup.test.ts` |
| API integration / E2E security tests | **Fail** | No E2E; Vitest unit coverage only |
| Structured security logging | **Partial** | Auth failures return JSON; no centralized audit log for admin actions |

**Recommended follow-up:** Smoke script extensions (`scripts/smoke-cutover.sh`) for `/setup` closed state + 401 on protected routes.

---

## Remediation tracker

| Gap | Severity | Suggested issue | Blocking OSS? |
|-----|----------|-----------------|---------------|
| Docker non-root | Medium | DevEx — harden Dockerfiles | No (document risk) |
| `nodemailer` CVE | High (low exposure) | Bump dependency | Yes before public repo |
| Upload MIME policy | Low–Medium | Drive hardening | No |
| E2E / IDOR tests | Medium | Test engineering | No |
| Hosted RLS | Critical (hosted only) | WHO-177–198 | Shipped M3; Stripe still blocks SaaS launch |

---

## Sign-off checklist (operator)

Before pointing a domain at a fresh self-host:

- [ ] `ALLOW_PUBLIC_SIGNUP=false`, `AUTH_REQUIRED=true`
- [ ] Unique `SESSION_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `S3_*`
- [ ] `SETUP_TOKEN` set for greenfield; rotated/removed after first owner
- [ ] HTTPS via reverse proxy; `PUBLIC_APP_URL=https://…`
- [ ] Firewall: only 80/443 public
- [ ] `DRIVE_PUBLIC_SHARES_ENABLED=false` if share links unused
- [ ] Google OAuth in Testing mode with explicit test users (if used)
- [ ] Postgres + MinIO volumes in backup plan

See also: [SETUP.md](./SETUP.md) · [SELF_HOST.md](./SELF_HOST.md) · [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) · [HOSTED_RLS.md](./HOSTED_RLS.md) (shared-mode policies)
