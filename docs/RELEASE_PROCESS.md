# Release process

## Versioning

Domi Ops follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR** — breaking changes to the self-host contract (env vars, DB schema requiring manual
  intervention, removed modules)
- **MINOR** — new features, additive schema migrations, new modules
- **PATCH** — bug fixes; no schema changes, or additive-only backward-compatible ones

The canonical version lives in the root `package.json` (`version` field) and is stamped onto GHCR
images via git tags (`vX.Y.Z`).

## Changelog

Every user-visible change (new feature, behavior change, bug fix) gets an entry under
`## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md), added in the PR that ships it — not batched
after the fact. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections
(`Added` / `Changed` / `Fixed` / `Removed` / `Security`).

## Migration notes

Any PR that adds a file to `packages/db/drizzle/` (a new migration) must:

1. Register it in `packages/db/drizzle/meta/_journal.json` — required for `db:migrate` to pick it up.
2. Note in its CHANGELOG entry that a migration is required, e.g. *(requires `npm run db:migrate`)*.
3. Call out any manual step a self-hoster needs beyond running the migration (new required env var,
   one-time backfill, etc.) — or state explicitly that there are none.

## Cutting a release

1. Bump `version` in the root `package.json` (and any workspace package that needs it).
2. Move `[Unreleased]` in `CHANGELOG.md` to a new `## [X.Y.Z] - YYYY-MM-DD` heading; leave a fresh
   empty `[Unreleased]` above it.
3. Commit: `:bookmark: chore(release): vX.Y.Z`.
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` — this triggers
   `.github/workflows/publish-images.yml`, which builds and pushes GHCR images tagged `latest`,
   `X.Y.Z`, and `sha-<short>`.
5. Create a GitHub Release from the tag. GitHub auto-drafts notes from merged PRs via
   `.github/release.yml`; edit for clarity and paste in the matching CHANGELOG section.
6. If the release includes a migration, say so at the top of the release notes.

## GHCR image tags

Published by `.github/workflows/publish-images.yml` on every push to `main` and on `v*` tags:

| Tag | Meaning |
|-----|---------|
| `latest` | Most recent `main` build |
| `X.Y.Z` | A tagged release |
| `sha-<short>` | Exact commit, for pinning |

Self-hosters pin a specific tag via `DOMI_OPS_IMAGE_TAG` in `.env` — see
[docs/SETUP.md](SETUP.md#path-c-production-with-pre-built-images).
