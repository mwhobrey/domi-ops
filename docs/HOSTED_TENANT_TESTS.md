# Hosted tenant isolation test matrix (WHO-197)

Prove cross-household leakage is impossible when `DEPLOYMENT_MODE=shared` and RLS policies (`0038`/`0039`) are applied.

## Prerequisites

1. Postgres with migrations applied (`npm run db:migrate`).
2. Hosted QA seed (`npm run db:seed-hosted-qa`) — creates **Alpha** and **Beta** households with distinct notes.
3. RLS-enforced app role (`npm run db:create-app-role`) — `domi_ops_app` is non-superuser (`NOBYPASSRLS`); required because dev `domi_ops` bypasses RLS.
4. `HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:domi_ops_app@localhost:5432/domi_ops` (or set `DATABASE_URL` to the app role for `test:hosted`).

```bash
docker compose -f docker-compose.yml -f docker-compose.hosted.yml up -d postgres
npm run db:migrate
npm run db:seed-hosted-qa
npm run db:create-app-role
HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:domi_ops_app@localhost:5432/domi_ops npm run test:hosted
```

`test:hosted` runs `vitest.hosted.config.ts`, which picks up every `*.integration.test.ts` under `packages/` and `apps/`. **A new test needs no registration**: name it `*.integration.test.ts`, have it skip itself without a database URL, and CI runs it as the app role. Use the app role, not a superuser, because a superuser bypasses RLS and would hide a missing policy.

## Automated matrix (`packages/db/src/tenant-isolation.integration.test.ts`)

| Case | Expectation |
|------|-------------|
| Tenant A reads notes | Sees only Alpha note (`alpha-secret-note`) |
| Tenant B reads notes | Sees only Beta note (`beta-secret-note`) |
| Tenant A inserts note | Visible under A; invisible to B |
| Worker scan context | Can read households across tenants (trusted process) |
| System context | Bootstrap path can insert households (greenfield only) |

## Billing bootstrap matrix (`packages/db/src/billing-system-bootstrap.integration.test.ts`)

Added 2026-08-25 after the Stripe webhook's household/`household_subscriptions` provisioning was found to have no working RLS path under `domi_ops_app` (migration `0056_billing_system_bootstrap.sql`, `docs/HOSTED_RLS.md`).

| Case | Expectation |
|------|-------------|
| Household insert with no RLS context | Rejected — proves RLS is actually enforced, not just installed |
| Household + `household_subscriptions` insert inside `withSystemContext` | Succeeds |
| Read `household_subscriptions` by `stripeCustomerId` inside `withSystemContext` | Finds the row (same shape as `hosted-setup/validate`) |

## Health checks matrix (`packages/db/src/health-checks-isolation.integration.test.ts`)

Added with the scheduled health checks tables (WHO-379/380, migration `0085_health_checks`: `health_checks`, `health_check_groups`, `health_check_group_members`, `health_check_group_shares`, `health_check_shares`, `health_check_pauses`, `health_check_logs`, `health_check_reminder_sent`, `health_check_group_reminder_sent`). Seeds its own rows in Alpha and Beta (plus a second Alpha member) and deletes them afterwards.

| Case | Expectation |
|------|-------------|
| Alpha / Beta read checks and groups | Each sees only its own |
| Child tables (logs, pauses, shares, group members, group shares) | Each tenant gets back exactly its own rows (asserted by id, not just count); asking for only the other tenant's ids returns nothing |
| No household context | Zero rows |
| Cross-tenant insert (check, log, reminder-sent) | Rejected by RLS (`42501`); an UPDATE aimed at the other tenant's row matches nothing |
| Links to another household's records | A log pointing at the other tenant's event, a check or group shared with the other tenant's member, and a group containing the other tenant's check are all rejected by RLS; the same log with the tenant's own event is allowed (positive control) |
| Group holds only one member's checks | A group cannot contain a check of a different member, even in the same household (composite foreign key, `23503`) |
| Worker scan context | Sees both tenants |
| DB constraints | `medication` event type and `prn`/`otc` schedule kinds (checks and groups) are rejected by CHECK (`23514`); a second log for the same check and instant is rejected (`23505`) |

These only mean anything as the non-superuser `domi_ops_app` role; as a superuser the four isolation cases fail by design.

## Health checks API matrix (`apps/api/src/routes/health-checks.integration.test.ts`)

WHO-382. Drives the real `/api/health/checks` and `/api/health/check-groups` handlers through the real tenant middleware (a fake-auth parent app sets `auth` from an `x-as` header), so every request runs in a household-scoped RLS transaction. Seeds its own households and deletes them afterwards.

| Case | Expectation |
|------|-------------|
| Who sees a private check | Creator, the subject, and `events` read/write grantees. Not an admin without a grant, not a stranger, not another household. List and single GET always agree |
| Write by someone who cannot see it | 404 (existence is not revealed), never 403 |
| Household-visible check | Everyone sees it; only the creator or an `events` writer can PATCH/DELETE (WHO-339) |
| Shares | Household members only (other households and the creator are filtered out), read-only, hidden from non-editors, cleared when made household-visible |
| Create | `events` write on the member; member must belong to the caller's household (404 otherwise) |
| Validation | `medication` type, `prn`/`otc`, empty vitals template, bad dates, oversized names, non-boolean flags all 400 with a specific code |
| Immutable fields | `memberId` and `eventType` cannot change after create |
| Pause / resume | `enabled` flips open and close pause periods, once per change |
| Soft delete | `deleted_at` set, disabled, hidden, removed from groups; a second delete is 404 |
| Groups | Only the group member's checks (400 `member_mismatch`); several groups per check; viewers only see member checks they may see; same write rules as checks |
| Module / auth | 403 without the health module; 401 unauthenticated |
| Reminder scan (`health.check.reminder.scan`, WHO-386) | Runs in the worker-scan context (cross-tenant by design) and only ever notifies users of the check's own household. Recipients are the person plus `events: write` grantees with health push on (not `events: read`, not `doses: write`); a slot that is answered gets nothing; each device is reminded in its own time zone; one reminder per recipient, device, slot and offset, and one overdue nudge; paused, deleted, out-of-range and module-off checks send nothing |
| Slot status (`GET /checks/slots`, WHO-384) | Only checks the caller can see (admin without a grant, stranger and other households get none). A slot is done through a log, or through an unlinked entry of the same person, kind and (vitals) metrics within 30 minutes, closest first and one entry per slot; an explicit skip beats a nearby entry; `eventId` is only returned for entries the caller may open, but the slot still reads done; days are laid out in the `x-client-timezone` zone; paused and deleted checks have no slots |
| Undo / edit a slot (`DELETE` / `PATCH /checks/:id/logs/:logId`, WHO-385) | Same bar as logging: `events` write on the person and sight of the check (reader 403; admin without a grant, stranger and other households 404; a deleted check's logs are unreachable). A log is only reachable through its own check. Undo keeps the reading unless `?deleteEvent=true`, which is refused (409) while another check relies on it. Edit: done / skipped, swap or clear the entry, move to a free slot (409 if taken), note; `missed` cannot be set by a client |
| Reading changes (`DELETE` / `PATCH /health/events/:id`, WHO-385) | Deleting a reading, re-typing it, or handing it to someone else removes the slot completions it backed, so the slot reads open again; any other edit leaves them; skipped slots are untouched |
| Logging a slot (`POST /checks/:id/log`, WHO-383) | Needs `events` write on the person and visibility of the check (reader 403, admin without a grant 404). The linked event must be visible to the caller (otherwise 404, nothing revealed), the same person, and the same kind of entry; 409 if it already completes another slot of the check. Seconds are truncated, repeating a slot replaces the answer, and a slot counts however early or late the event was |

## Pharmacies, supply, organizers and their reminders (WHO-413 to WHO-434)

The medication filling and pharmacy feature adds sixteen tables over three migrations (`0087_health_supply`, `0088_health_organizers`, `0090_health_supply_reminders`); `0091_health_supply_least_privilege` narrows the worker's reach. All of them have `household_isolation`. Only `health_organizer_plans` and `health_medication_supply` also have `worker_scan`, because the scheduler's tick is the one cross-tenant reader (see [HOSTED_RLS.md](./HOSTED_RLS.md)). Everything runs as the non-superuser app role, and every file skips itself without a database URL.

### Database level

| Case | Where | Expectation |
|------|-------|-------------|
| Household isolation: pharmacies, supply, revisions, refill events, person-wide lead time | `packages/db/src/health-supply-isolation.integration.test.ts` | Each household sees only its own rows, by id; no household context returns nothing |
| Household isolation: plans, compartments, time map, caregivers, occurrences and their history, sessions, fills, dose quantities | `packages/db/src/health-organizer-isolation.integration.test.ts` | Same, down to the child tables |
| Household isolation: sent fill and refill reminders | `packages/db/src/health-supply-reminders-isolation.integration.test.ts` | Same; no context returns nothing |
| Cross-household references rejected | the three files above | A medication pointed at another household's pharmacy, a time-map row at another plan's compartment, a fill at another household's session or medication, a reminder recorded for another household's plan or medication: all rejected by RLS (`42501`) or a foreign key (`23503`); an UPDATE or DELETE aimed at another tenant's row matches nothing |
| Worker scan context reaches only what the tick reads | `health-supply-reminders-isolation.integration.test.ts`, `rls-worker-scan-coverage.integration.test.ts` | Among this feature's tables exactly `health_organizer_plans` and `health_medication_supply` carry `worker_scan`; a worker-scan transaction sees no pharmacy and no sent reminder, cannot record one (`42501`), and sees no supply revision |
| A reminder can be claimed once | `health-supply-reminders-isolation.integration.test.ts` | A second claim for the same appointment and person, or the same estimate revision, kind and person, is `23505`; a new revision or the other kind goes through; an unknown kind is `23514` |
| Append-only supply history | `health-supply-isolation.integration.test.ts` | An UPDATE or DELETE of a revision is refused (`23001`); the foreign keys still cascade |

### API level (real routes through the real tenant middleware)

All in `apps/api/src/routes/health-pharmacies`, `health-supply`, `health-refills`, `health-organizers`, `health-organizer-appointments` and `health-organizer-sessions` `.integration.test.ts`.

| Case | Expectation |
|------|-------------|
| Household isolation | Another household's pharmacy, supply, refill, plan, appointment or session is 404, never a leak and never 403 |
| Read-only access | A reader (or a child without a grant) can look; every change is refused. A writer can do both |
| Revoked caregiver | After the grant is removed, a caregiver who could change things before is refused, partway through a session included, and nothing is changed |
| Private medication filtering | Pharmacy counts and lists, supply summaries, the refill list, setup problems, session medications, change summaries and appointment effects include only what the caller may see, and a request for a hidden one never reveals that it exists (archive confirmations included) |
| Cross-household references rejected | A pharmacy of another household on a medication's supply, a caregiver or person outside the household, a group that is another person's, another person's medication in a session: 404 or 400 with a specific code, nothing written |
| Not through another plan | A session or appointment id under the wrong plan is 404 |

### Calendar, dashboard and reminders

| Case | Where | Expectation |
|------|-------|-------------|
| Calendar chips (`health_supply`) | `apps/api/src/lib/calendar-supply-overlays.integration.test.ts` | Appointments only for people who may read the person's medications; refill deadlines only for medications the viewer may see (a private one is invisible to an owner or admin without access, to a stranger, and to a caregiver without access); each chip lists only people who may see it |
| Dashboard Health tile refills | the same file | Only visible, active, unrequested medications whose deadline has come |
| Reminder job: own household only, no cross-tenant policy | `packages/calendar-sync/src/health-supply-reminder-scan.integration.test.ts` | The job runs in `withHouseholdContext`, so it needs no `worker_scan` policy on any table it touches (0091 removed them from its tables and the suite passes); a scan for one household sends nothing for another, whatever time zone it is on |
| Recipients and access at send time | the same file | Only the plan's selected caregivers (the person when there is no plan), each rechecked for medications read at send time; a private medication reaches only people who can see it, with no admin override; inbox for everyone, push only where the health reminders setting is on |
| The tick | `packages/calendar-sync/src/health-supply-reminder-fanout.integration.test.ts` | One job per household with a plan or an estimate and the health module, nothing else |

A new `*.integration.test.ts` needs no registration: `npm run test:hosted` picks it up.

What the feature does and where the code is: [MEDICATION_SUPPLY.md](./MEDICATION_SUPPLY.md).

## Manual API checks (after `dev:hosted` stack)

1. Log in as `alpha@hosted-qa.domi-ops.test` — `/api/core/notes` returns one note.
2. Log in as `beta@hosted-qa.domi-ops.test` — different note; no alpha title in list.
3. PATCH settings with module above entitlement ceiling → `400 invalid_modules`.
4. Authenticated user without household membership on hosted → `500 tenant_context_required`.

## CI

GitHub Actions job `test-hosted` in `.github/workflows/ci.yml`:

1. Postgres 16 service container (`domi_ops` / `domi_ops` / `domi_ops`)
2. `npm run build`, `npm run migrate:run -w @domi-ops/db`, `npm run seed:hosted-qa -w @domi-ops/db`
3. `npm run db:create-app-role` (non-superuser `domi_ops_app` for RLS-enforced tests)
4. `npm run test:hosted` with `HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:domi_ops_app@localhost:5432/domi_ops` — runs both `tenant-isolation.integration.test.ts` and `billing-system-bootstrap.integration.test.ts`

Runs on push/PR to `main` alongside the main CI build job.

## Security review linkage

Results feed [WHO-172](https://linear.app/mikewhob-whome/issue/WHO-172) hosted tenant isolation section after WHO-197 passes locally.
