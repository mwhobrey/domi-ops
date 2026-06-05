# whome — Master Runbook Index

## Executive summary

**whome** is an open-source household operations platform (calendar, homeschool LMS, shopping, chores, notes, expenses) built to replace [HomeHub](https://github.com/surajverma/homehub). It is a TypeScript monorepo: Next.js UI, Hono REST API, BullMQ worker, Drizzle/PostgreSQL, Redis queues, MinIO/S3 files. Primary deployment target is self-hosted Docker on a DigitalOcean droplet behind Caddy; hosted multi-tenant tiers are designed but not implemented in code yet.

## North Star

**One household runs daily life in whome** — migrated from HomeHub, Google Calendar imported (then optionally synced), homeschool and core modules on a single Postgres instance — with enterprise-grade UX and a path to optional hosted tiers without rewriting the core.

## When to read what

| If you are… | Read first |
|-------------|------------|
| New to the repo | This file → [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) |
| Adding/changing a feature | [02_COMPONENTS_AND_FILES.md](./02_COMPONENTS_AND_FILES.md) + relevant route/schema file |
| Fixing auth, cookies, or Docker networking | [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) (auth/proxy section) + [03_RULES_AND_STANDARDS.md](./03_RULES_AND_STANDARDS.md) |
| Shipping or deploying | [03_RULES_AND_STANDARDS.md](./03_RULES_AND_STANDARDS.md) + `docker-compose.prod.yml`, `deploy/Caddyfile.example` |
| Prioritizing work | [04_CURRENT_STATE.md](./04_CURRENT_STATE.md) |
| Manual School QA / import check | [05_SCHOOL_QA.md](./05_SCHOOL_QA.md) |

## Table of contents

| File | Contents |
|------|----------|
| [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) | Stack, patterns, data flow, external APIs |
| [02_COMPONENTS_AND_FILES.md](./02_COMPONENTS_AND_FILES.md) | Directory map, modules, config/routing/state |
| [03_RULES_AND_STANDARDS.md](./03_RULES_AND_STANDARDS.md) | Conventions, errors, testing, deployment, gotchas |
| [04_CURRENT_STATE.md](./04_CURRENT_STATE.md) | Working vs broken, next steps |
| [05_SCHOOL_QA.md](./05_SCHOOL_QA.md) | School module manual QA + post-import verification |

## Supplementary docs (outside runbook)

- `README.md` — quick start, import, production pointers
- `docs/ARCHITECTURE.md` — product tiers, cutover checklist
- `docs/GOOGLE_OAUTH_SETUP.md` — Google Cloud Console redirect URIs

## Repo facts (grounded)

- **Node:** `>=20` (`package.json` `engines`)
- **Package manager:** npm 10.9.2 workspaces + Turborepo
- **Commits on `master`:** `a96a368` (cutover baseline), `4b67280` (initial platform)
- **CI:** GitHub Actions on push/PR (`typecheck`, `build`, `test`)
- **Tests:** Vitest — `npm run test`

## Quick commands

```bash
cp .env.example .env
docker compose up -d postgres redis minio
npm install && npm run build && npm run db:migrate
npm run dev   # web :3000 local; Docker web maps host :3001
```

- Web (Docker): `http://localhost:3001`
- API health: `http://localhost:4000/health`
