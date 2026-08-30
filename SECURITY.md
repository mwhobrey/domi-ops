# Security policy

## Supported versions

Domi Ops ships from a single `main` branch — the latest release is the only supported version.
There's no LTS branch; self-hosters are expected to update via [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

## Reporting a vulnerability

Please **don't open a public issue** for a security vulnerability. Instead:

- Preferred: use GitHub's [private vulnerability reporting](https://github.com/mwhobrey/domi-ops/security/advisories/new)
  if it's enabled on this repo (Security tab → "Report a vulnerability").
- Otherwise: send a private message to [@mwhobrey](https://github.com/mwhobrey) on GitHub with
  details and, if possible, a reproduction.

Include what you'd expect in any report: affected version/commit, impact, and reproduction steps.
There's no bug bounty — this is a solo-maintained project — but reports are read and acted on.

## What's already documented

[docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) is a standing self-audit (auth, secrets,
household/tenant isolation, uploads, health-data encryption, dependencies, Docker hardening) with
known gaps and their status — check there before reporting something already tracked. Its
"Sign-off checklist (operator)" section covers what a self-hoster should configure before
exposing an instance to the internet.

## Dependencies

Dependabot is enabled on this repo. `npm audit` findings are triaged per
[docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md#6-dependencies) — runtime-reachable
vulnerabilities are fixed promptly; dev/build-time-only ones (e.g. a transitive tool dependency
with no upstream fix yet) are documented and tracked instead of blocking on an unavailable patch.
