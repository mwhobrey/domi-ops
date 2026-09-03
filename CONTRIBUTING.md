# Contributing to Domi Ops

Thanks for helping improve Domi Ops. This is a household operations monorepo. Keep changes focused and match existing patterns.

By participating, you're expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs & requesting features

Use the issue templates: [bug report](../../issues/new?template=bug_report.yml), [feature request](../../issues/new?template=feature_request.yml),
or [self-host setup help](../../issues/new?template=self_host_help.yml). Open-ended questions belong in
[Discussions](../../discussions) rather than Issues.

## Repository map

| Path | Role |
|------|------|
| `apps/web` | Next.js 15 UI (App Router) |
| `apps/api` | Hono HTTP API |
| `apps/worker` | BullMQ jobs (calendar sync, reminders, recurring) |
| `packages/db` | Drizzle schema + SQL migrations |
| `packages/auth` | Better Auth configuration |
| `packages/config` | Zod env validation |
| `packages/calendar-sync` | Google Calendar pull/push |
| `packages/import-homehub` | HomeHub SQLite → Postgres CLI |
| `docs/` | Operator and parity docs |
| `.cursor/runbook/` | Agent runbook (architecture, current state) |

## Development setup

**Prerequisites:** Node 20+, Docker (for Postgres, Redis, MinIO).

```bash
cp .env.example .env
docker compose up -d postgres redis minio
npm install
npm run build
npm run db:migrate   # required before first login
npm run dev
```

- Web: http://localhost:3000 (native dev default)
- API health: http://localhost:4000/health
- Reset local DB: `npm run dev:reset`

For full stack in Docker (web on host :3001), use `.env.docker.example` instead. See [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md) if you change ports.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start web, api, worker in parallel |
| `npm run build` | Turbo build all workspaces |
| `npm run typecheck` | TypeScript across monorepo |
| `npm run lint` | ESLint (web app) |
| `npm run test` | Vitest unit tests |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:generate` | Generate migration from schema changes |
| `npm run import:homehub` | HomeHub import CLI |
| `npm run import:validate` | Fixture dry-run (no Postgres) |

New SQL migrations must be registered in `packages/db/drizzle/meta/_journal.json`.

## Conventions

- TypeScript strict; ESM with `.js` extensions in API/worker import paths.
- Workspace packages: `@domi-ops/<name>`.
- API routes scoped by household after `requireAuth`.
- Web fetches session per request; no client-side token storage.
- UI components live in `apps/web/src/components/ui/`; page-specific logic in feature components.
- Read `.cursor/runbook/03_RULES_AND_STANDARDS.md` before non-trivial changes.

## Commit messages

Use gitmoji + conventional scope when a Linear ticket exists:

```
WHO-42 :sparkles: feat(calendar): add category filter pills
```

Without a ticket, omit the bracket prefix. No commit trailers (`Co-authored-by`, etc.).

## Pull requests

1. Run `npm run typecheck` and `npm run test` on touched areas.
2. Update `.cursor/runbook/04_CURRENT_STATE.md` if behavior changed.
3. Describe manual test steps for UI or API changes.
4. Add a `CHANGELOG.md` entry under `[Unreleased]` for any user-visible change — see
   [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md), including a migration note if the PR adds a
   `packages/db/drizzle/` migration.

## Self-hosting

See [docs/SELF_HOST.md](docs/SELF_HOST.md) for production deployment.

## License

MIT. See [LICENSE](LICENSE).
