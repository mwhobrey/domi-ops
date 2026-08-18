# Domi Ops — Master Runbook Index

## Executive summary

**Domi Ops** is an open-source household operations platform (calendar, homeschool LMS, shopping, chores, notes, expenses). It is a TypeScript monorepo: Next.js UI, Hono REST API, BullMQ worker, Drizzle/PostgreSQL, Redis queues, MinIO/S3 files. Primary deployment today is self-hosted Docker (household dogfood). **Public launch is still OSS self-host and Domi Ops hosted together** — Hosted Starter foundation (RLS, tenant context, entitlements) is in code; remaining work is billing, legal, marketing deploy, and the public repo flip. See [07_LAUNCH.md](./07_LAUNCH.md).

## North Star

**One household runs daily life in Domi Ops** — calendar, homeschool, and core modules on a single Postgres instance — with enterprise-grade UX. Self-host and managed hosted tiers share one codebase; both ship at public OSS launch when ready.

## When to read what

| If you are… | Read first |
|-------------|------------|
| New to the repo | This file → [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) |
| Adding/changing a feature | [02_COMPONENTS_AND_FILES.md](./02_COMPONENTS_AND_FILES.md) + relevant route/schema file |
| Fixing auth, cookies, or Docker networking | [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) (auth/proxy section) + [03_RULES_AND_STANDARDS.md](./03_RULES_AND_STANDARDS.md) |
| Shipping or deploying | [03_RULES_AND_STANDARDS.md](./03_RULES_AND_STANDARDS.md) + `docker-compose.prod.yml`, `deploy/Caddyfile.example` |
| Prioritizing work | [07_LAUNCH.md](./07_LAUNCH.md) (launch) then [04_CURRENT_STATE.md](./04_CURRENT_STATE.md) |
| Manual School QA / import check | [05_SCHOOL_QA.md](./05_SCHOOL_QA.md) |
| Dogfood test phases (session tracker) | [06_DOGFOOD_TEST_PHASES.md](./06_DOGFOOD_TEST_PHASES.md) |

## Table of contents

| File | Contents |
|------|----------|
| [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) | Stack, patterns, data flow, external APIs |
| [02_COMPONENTS_AND_FILES.md](./02_COMPONENTS_AND_FILES.md) | Directory map, modules, config/routing/state |
| [03_RULES_AND_STANDARDS.md](./03_RULES_AND_STANDARDS.md) | Conventions, errors, testing, deployment, gotchas |
| [04_CURRENT_STATE.md](./04_CURRENT_STATE.md) | Working vs broken, next steps |
| [05_SCHOOL_QA.md](./05_SCHOOL_QA.md) | School module manual QA + post-import verification |
| [06_DOGFOOD_TEST_PHASES.md](./06_DOGFOOD_TEST_PHASES.md) | Phased dogfood checklist + session handoff |
| [07_LAUNCH.md](./07_LAUNCH.md) | OSS + hosted public launch: policy, legal/marketing gates, M5 order |

## Supplementary docs (outside runbook)

- `README.md` — quick start, import, production pointers
- `docs/ARCHITECTURE.md` — product tiers, cutover checklist
- `docs/adr/001-public-launch-scope.md` — OSS + hosted launch policy
- `docs/GOOGLE_OAUTH_SETUP.md` — Google Cloud Console redirect URIs
- `docs/SECURITY_REVIEW.md` — pre-launch security checklist (WHO-172)
- `docs/HOSTED_RLS.md` — hosted tenant context + RLS policies
- `docs/HOSTED_TENANT_TESTS.md` — cross-tenant leak test matrix (WHO-197)
- `deploy/HOSTED_OPS.md` — hosted monitoring, backups, incidents (WHO-180)
- `docs/TROUBLESHOOTING.md` — self-host failure index (WHO-175)
- `docs/marketing/PRICING_TIERS.md` — hosted SKU / price lock
- `docs/marketing/LAUNCH_DECISIONS.md` — pre-launch sign-off (entity: DBA Domi Ops, sole proprietor)

## Repo facts (grounded)

- **Node:** `>=20` (`package.json` `engines`)
- **Package manager:** npm 10.9.2 workspaces + Turborepo (`@domi-ops/*` scope)
- **Commits on `master`:** `a96a368` (cutover baseline), `4b67280` (initial platform)
- **CI:** GitHub Actions on push/PR (`typecheck`, `build`, `test`)
- **Tests:** Vitest — `npm run test`

## Quick commands

```bash
cp .env.example .env
docker compose up -d postgres redis minio
npm install && npm run build && npm run db:migrate
npm run dev   # web :3000 local; Docker web maps host :3001
# Hosted QA (shared mode): npm run dev:hosted && npm run db:migrate && npm run db:seed-hosted-qa
```

- Web (Docker): `http://localhost:3001`
- API health: `http://localhost:4000/health`
