# Scheduled health checks

Scheduled health checks are the sibling of medications: a recurring prompt to measure something
("Ally's blood pressure, four times a day") instead of to take something. They live on the Health
page's **Checks** tab. This page is the reference for how they behave and where the code is.

Linear: WHO-379 to WHO-395 (tables, API, reminders, UI, reports, hardening).

## What a check is

A check belongs to one person (a household member) and asks for one kind of reading: `vitals`
(blood pressure, pulse, weight and so on) or any other health event type. It has:

- a **template**: which metrics to ask for;
- a **schedule**: either `scheduled` (fixed clock times, optional weekdays) or `interval` (every N
  minutes, anchored to the first answered check or to a clock time, stopping at midnight);
- **reminder offsets**: minutes before each time to nudge (default one reminder at the time).

Logging a check writes a normal `health_events` row. A "slot" (one scheduled time) counts as
answered when there is a `health_check_logs` row for it or a matching reading inside the
tolerance window (30 minutes). Deleting or re-typing the reading reopens the slot.

### Slot statuses

`done`, `skipped`, `missed` (past the tolerance with no answer), `due`, `overdue`, `upcoming`.
Computed by `computeSlotStatuses` / `loadCheckSlotStatuses` in `packages/calendar-sync`, never
stored. Interval checks look back far enough to find the log that anchors their clock.

## Groups

A group bundles one person's checks so they share one reminder ("Morning: BP, weight").

- One reminder per group time, listing only the members still waiting.
- A member check's slot is **claimed per instant**, not per clock time: if a group covers a check
  at 08:00, the check's own 08:00 reminder is suppressed, but a 09:00 group does not swallow an
  08:00 check.
- An interval group takes over the reminders of its interval checks (on the days the group runs). It never suppresses a scheduled check's own reminders.
- Group reminders carry no action buttons. They deep link to `/health?checkGroup=<id>`.

## Reminders

Worker job `health.check.reminder.scan` ticks every 5 minutes and fans out one
`health.check.reminder.household` job per household (see "Per-household scans" below).

- Recipients: the person plus anyone granted `events: write` on them, with health push enabled.
  `events: read` and `doses: write` do not qualify.
- Each device is reminded in its own time zone.
- One reminder per recipient, device, slot and offset. One **overdue** nudge at +30 minutes
  (stored as offset -30).
- Nothing is sent for an answered slot, or for a paused, deleted, out-of-range or module-off check.
- Dedupe tables: `health_check_reminder_sent`, `health_check_group_reminder_sent`.

### Push buttons

A single-check reminder has **Log now** (opens `/health?check=<id>&scheduledAt=<iso>`) and **Skip**.

- Skip posts a signed token to `POST /api/health/checks/push-action`. The route is registered
  before `requireAuth`; the token is the credential.
- The token is an HMAC (`mintHealthCheckPushActionToken` in `packages/crypto`) with claims distinct
  from medication tokens, **skip only**, and travels in the push `data`, never in a URL.
- The handler opens its own household context, rechecks `events: write`, and **never overwrites an
  answered slot** (stale buttons are common). It records through `recordCheck` with source `bulk`.
- The service worker handler lives in `apps/web/public/sw.js` (cache version v4).

## Sharing and access

Checks follow the same health ACL as events: you see and edit your own; `events: read` shows
someone else's, `events: write` lets you log, edit and set up their checks. Checks and groups
also have explicit share tables (`health_check_shares`, `health_check_group_shares`).

## Where they show up

| Surface | What you get |
|---------|--------------|
| Health, **Today** | "My checks" / "Sofia's checks": group blocks, a Log next queue |
| Health, **Checks** | Setup sheets, groups, pause, delete, per-person grouping |
| Dashboard Health tile | Today's checks still waiting, progress (`pendingChecks`, `checkProgress` from the glance) |
| Calendar | `health_check` overlay chips; the month view collapses them to one chip per day |
| Reports | `check-adherence` and `blood-pressure` kinds, date range and person filter, same exports as other reports |

Report notes: adherence counts from a check's creation day, so history before that is not
scored. Ranges are capped at 366 days (`assertCheckReportRange`); a longer one returns 400.

## Limits

Enforced in the API so a bad client cannot make the worker do unbounded work.

| Limit | Value | Error |
|-------|-------|-------|
| Times per check or group | 48 distinct (repeats collapse) | 400 `too_many_times` |
| Time format | strict `HH:MM` (seconds are dropped) | 400 `invalid_time` |
| Reminder offsets per time | 10, whole minutes, 0 to 10080 (one week); invalid values are dropped | none |
| Checks per person | 100 (deleted ones do not count) | 409 `too_many_checks` |
| Groups per person | 50 | 409 `too_many_groups` |

The per-person caps take a transaction-scoped advisory lock (`lockCheckQuota`) before counting, so
two concurrent creates cannot both squeeze past the limit.

Migration `0086_health_events_member_type_time_idx` adds the index
`health_events_household_member_type_started_idx` on `(household_id, member_id, type, started_at)`,
the shape every slot status, report, calendar and dashboard lookup uses.

## Architecture notes

### Per-household scans

Reminder scans no longer sweep every tenant in one query. A tick job enumerates households and
enqueues one job per household with a deterministic job id (`householdScanJobId`), so a slow
household cannot stall others and a retry is idempotent. All the household scans (medication,
group, check reminders and the rest) share this machinery:
`packages/calendar-sync/src/household-scan-fanout.ts`, `scan-fanout.ts`,
`health-reminder-fanout.ts`; dispatch is in `sync.ts`. Each scan accepts `{ householdId }`.
Interval per job type: 5, 15 or 30 minutes (`HOUSEHOLD_SCAN_INTERVAL_MS`).

Per-household scans run in `withWorkerScanContext` scoped to that household, which is why no
cross-tenant RLS policy on `health_member_acl` was needed (a migration for one was written and
dropped).

### Code map

| Area | Files |
|------|-------|
| Tables | `packages/db/src/schema/health.ts`, migration `0085_health_checks`, `0086_*` |
| Routes | `apps/api/src/routes/health-checks.ts`, `health-check-groups.ts`, push action in `household-health.ts` |
| Schedule rules | `apps/api/src/lib/health-check-schedule.ts`, `health-check-quota.ts` |
| Slot logic | `packages/calendar-sync/src/health-check-status.ts`, `health-check-reminder-plan.ts` |
| Reminders | `health-check-group-reminders.ts`, `health-check-push-actions.ts`, scan files above |
| Glance, calendar, reports | `lib/health-check-glance.ts`, `lib/calendar-overlays.ts`, `lib/health-check-reports.ts` |
| Web | `HealthPageClient`, `health/TodayChecksCard`, `ChecksManagerClient`, `HealthCheckSheet`, `HealthCheckGroupSheet`, `MedScheduleEditor`, `reports/HealthCheckReportPanel` |

## Tests

- `packages/db/src/health-checks-isolation.integration.test.ts`: tenant isolation matrix.
- `apps/api/src/routes/health-checks.integration.test.ts`: API matrix (see
  [HOSTED_TENANT_TESTS.md](./HOSTED_TENANT_TESTS.md)); runs as the non-superuser app role because a
  superuser bypasses RLS.
- `packages/db/src/health-events-index.integration.test.ts`: the lookup index exists and is usable.
- Unit tests beside the calendar-sync, schedule, report and web helper modules.

## Troubleshooting

- **No reminder arrived:** is the slot already answered? Is the check paused or past its end? Does
  the recipient have health push on and a subscription? A group covering that instant claims the
  slot from the single check.
- **Skip button did nothing:** the token expired or the slot was answered since. Both are expected
  and silent by design.
- **`npm run build` before typechecking the API:** `packages/crypto` and `packages/calendar-sync`
  resolve from `dist`.

## Known gaps

- Today rows have no Edit action, and the Log tab does not mark entries that count for a check
  (WHO-391 leftovers).
- Medication dose calendar chips lack the attendee info the member filter needs.
- The worker loads slot statuses per check per time zone; it could batch.
