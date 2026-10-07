# Medication supply, pill organizers and pharmacies

How Domi Ops helps a household fill a pill organizer and ask for refills in time. It lives on the Health page's **Medications** tab (the **Pill organizer**, **Supplies** and **Pharmacies** cards) and shows up on the calendar, the dashboard and in reminders. This page is the reference for how it behaves and where the code is. It is modelled on [HEALTH_CHECKS.md](./HEALTH_CHECKS.md).

Linear: WHO-405 to WHO-440 (project "Medication filling and pharmacy management", milestones M0 to M5). Migrations: `0087_health_supply`, `0088_health_organizers`, `0089_health_supply_write_key`, `0090_health_supply_reminders`, `0091_health_supply_least_privilege` (run `npm run db:migrate`; the hosted tag deploy does it).

## The idea in one paragraph

Supply is a **user-confirmed estimate, never live inventory**. A person tells Domi Ops how many days of a medication they keep outside the organizer; Domi Ops adds the days the organizer still holds and works out the first date without supply. Logging a dose never changes it. A refill is due a lead time before that date (7 days unless chosen). Filling an organizer happens in a **filling session** that follows the bottle in the person's hand and records, per medication, which days were filled, which updates the estimate as it goes.

## Pharmacies

A household directory (`/api/health/pharmacies`): name, address, phone, website, notes; text fields encrypted at rest. A medication points at one pharmacy through its supply row. Archiving a pharmacy keeps the references; if visible medications use it the API asks for confirmation, and the prompt never reveals a medication the caller cannot see (counts are filtered by the normal medication visibility). Phone numbers get a `tel:` link, websites a link only for plain http(s) addresses.

Who may change it: owners and admins, adult members, and anyone with `medications: write` on another person. A child without a grant can read.

## The supply estimate

`PUT /api/health/medications/:id/supply` (and the first-run bulk entry, WHO-423) takes **days outside the organizers**. The server adds the days of pills the organizer still holds from today:

> Fill an organizer for 31 days starting today and keep 10 days of pills outside it: that is 41 days, so the supply runs out on day 42, `today + 41`. `runsOutOn` is the **first date without supply**.

- Organizer days are the unbroken run of filled days from today, taken from filling session fills that were not undone.
- **A gap** in what the organizers cover (for example a fill that starts after a break) cannot be added up: the API answers `needsConfirmation` and the person enters the **total days in hand** (`confirmedTotalDays`).
- `dryRun: true` previews the run-out date and writes nothing; the web shows it before every save.
- More than ten years (3650 days) is refused as a typo.
- Every estimate is appended to `health_medication_supply_revisions` (append-only: sources `fill`, `manual`, `receipt`, `confirm`); the supply row carries a `revision` and a `version` (send the version back when changing it; a stale one is a 409 with the current state).
- Writes carry a `lastWriteKey` (migration 0089) so a retried request returns the saved result instead of a second revision.
- A medication that was **paused and resumed** after its estimate was made has not been using pills, so the estimate **needs confirming**: it shows a prompt, and **no reminders go** until it is confirmed or replaced.

### Lead time and refill state

Lead time is the medication's own choice, else the person's default (`health_supply_settings`), else 7 days (0 to 90). The deadline is `runsOutOn - lead`. State, derived on read and never stored: `inactive` (paused or deleted), `no_estimate`, `not_needed` (the supply outlasts the medication's end date), `ok`, `needs_refill`, `requested`. "Days remaining" is for today.

## The refill workflow

Needs refill, then **Requested**, then **Received** (`/api/health/refills`, `POST /medications/:id/supply/request`, `/supply/receive`, `DELETE .../supply/request`):

- **Request** records "I contacted the pharmacy". It silences the reminder, keeps the medication visible as Requested until received, and can be cleared if it was a mistake. Asking twice is a no-op that says so.
- **Receive** takes the new total days in hand (plus the organizers' days, with the same gap rule) and writes a `receipt` revision, closing the request. A repeated receipt with the same key returns the first result.
- The list is grouped by pharmacy, soonest deadline first, filtered to what the viewer may see. Paused and deleted medications are left off.

## Pill organizers

One **plan per person** (`/api/health/organizers`): how often they fill (every N days from an anchor date, or a day of the month, where 29 to 31 means the month's last day when shorter), how many days one fill covers (1 to 93, 31 by default), a reminder time, who is reminded, and up to **eight named compartments** (four by default: Morning, Lunch, Supper, Night).

- **Mapping is by dose time**: each dose time of the person's scheduled medications maps to one compartment (`health_organizer_time_map`). A medication taken at several times can land in several compartments. A group named like a compartment maps all its times in one tap.
- **Quantities** are per medication per time, in **quarters of a pill** (¼ to 100, stored as integer quarters, `health_medication_dose_quantities`). The dosage text ("10 mg") is shown for reference and **never** used to fill a number: milligrams are not pills.
- **Only pills go in an organizer.** A medication has a **form** (`health_medications.form`: pill, iv, injection, liquid, other; pill by default). The others keep their schedule, reminders and refill tracking, are listed under "left out" as not a pill, and never raise a missing-quantity problem. Set it on the medication's edit screen. The medication editor also opens from the pills step, the filling panel and the supply cards, so a dosage written as one number (600 mg) can be broken out (2 x 300 mg) without leaving the setup; what was typed and not yet saved is kept.
- **Setup problems** are listed with the step that fixes them: dose times with no compartment, missing quantities, medications left out (as needed, over the counter, interval, paused, no fixed times), doses claimed by two groups (shown once). The plan is **ready** when there are no errors and at least one dose to place.
- Changing the schedule, quantities or mapping while a session is open does not stop the session; it asks for a **review** (below). A plan cannot be archived while a session is open; archiving keeps history and allows a new plan.
- Plan changes carry the `version` the client saw.

## Filling sessions

`/api/health/organizers/:planId/sessions`. One **open session per plan**; starting another returns the open one. A session starts from a **snapshot** of the instructions (encrypted, with a hash) for `coverageStart` and a fill length (defaults: the day after the organizer is already filled to, the plan's length).

- **Fill** a medication: the days filled (all of them, or fewer when pills run short; the missing days are named and can be filled later or in another session), the days outside the organizers, and an idempotency key. One call records the fill and saves the new supply estimate. A repeat with the same key returns the first result; reusing a key for a different fill is refused. The session `version` must match, so two caregivers filling different medications at once is safe (one retries with what the other left).
- **Progress** per medication: `pending`, `partial`, `filled`, `nothing_to_fill`, with the covered and missing ranges.
- **Review gate:** if the snapshot's hash no longer matches the instructions, `review_required` (409): filling pauses, the view lists what changed (schedule, quantity, compartment, renames) and the person accepts the new instructions (`POST .../review`). Fills already made stay filled and are not touched.
- **Undo** takes back a medication's latest fill and puts the previous estimate back as a new revision, unless the estimate was changed since (then it says so and leaves it).
- **Finish** and **stop** (abandon): both keep every fill and the estimates they made. Finishing requires at least one fill. **Neither creates dose logs**: filling is not taking. When something is filled and some medications are not fully filled, both dialogs name them, say the next session starts after the last day filled so it will not offer those days, and offer **Keep filling**. Nothing is decided for the person (WHO-440, WHO-444).
- Every medication is judged by what the **viewer** may see; the session itself is computed from all of the person's medications so every caregiver is told the same thing.

## Fill appointments

Appointments are **computed** from the plan's schedule, never stored until something is said about them (`/api/health/organizers/:planId/appointments`). Each day gets a window of that household-local day. Status: `upcoming`, `today`, `overdue`, `done`, `skipped`, `missed`.

- **Done by default** when a filling session started from the appointment was finished, or an unlinked one was finished on its day or the day after. A person's own answer always wins.
- Outcomes: done, skipped, missed, **moved to another day** (only that appointment moves, never the schedule; it cannot land on another appointment's day), back to pending. A note (encrypted) and a history of changes are kept. Changes carry a version and are serialised on the plan row.
- **What it affects** (for a skipped, missed, moved or overdue appointment): when pills next go in, how long the organizers last, which medications would go without pills before the next fill, and their refill deadlines, with the actions "start filling", "move it", "I have dealt with this". Resolving stops the flag until the answer changes.
- Changing the plan's schedule starts the upcoming appointments afresh and keeps what happened before.

## Where it shows up

| Surface | What you get |
|---------|--------------|
| Health, **Medications**, Pill organizer | Setup card with checklist, Start or Continue filling, appointment list |
| Health, **Medications**, Supplies | Per-person supply, refill actions, first-run bulk entry, confirm prompts |
| Calendar and dashboard schedule | `health_supply` all-day chips: fill appointments still to do and refill deadlines; the month view collapses a day's refills; they follow the **Medications** overlay setting and filter |
| Dashboard Health tile | "N refills" when refill deadlines have come (`refillsDue` on `GET /api/health/glance`) |
| Notices | Inbox notices from the reminders, each opening the appointment or the supply record |

Links: `/health?fill=<plan>&appointment=<day>&member=<person>` opens the organizer with that appointment; `/health?supply=<medication>` scrolls to the supply and marks it. A plan or medication that is gone says so.

## Reminders

Worker job `health.supply.reminder.scan` ticks every 5 minutes and fans out one `health.supply.reminder.household` job per household that has a plan or a supply estimate (same machinery as the dose and check scans, see HEALTH_CHECKS.md "Per-household scans"). Pure rules are in `health-supply-reminder-plan.ts`, the scan in `health-supply-reminder-scan.ts`.

- **Fill:** at the plan's reminder time on the appointment's day, while it is still to do (not done, skipped, missed, resolved, or covered by a finished session). A moved appointment reminds on its new day. A reminder missed during downtime goes on the next scan, once, worded as late; an appointment more than three days old is let go.
- **Refill:** 9:00 household time on the deadline's day, or at once when the estimate was entered inside the lead time. After a refill is **requested** it is silent except for **one "still waiting" nudge two days before the supply runs out**. Nothing for paused, deleted or finished medications, for an estimate that needs confirming, or after the supply has run out.
- **A new estimate replaces the pending reminder**: reminders are worked out from the current estimate, and each is claimed per revision.
- **Recipients:** the plan's selected caregivers (leaving everyone unticked means no reminders); a person without a plan is reminded themself. Access is **rechecked at send time**: medications read on the person, and for refills the medication must be visible to the recipient (a private one reaches only the usual people, no admin override).
- **Delivery:** an inbox notice for everyone; a push to their devices where their existing health reminders setting is on (no new setting). Notices about someone else start with their first name.
- **Once only:** `health_supply_fill_reminder_sent` (plan, appointment day, person) and `health_supply_refill_reminder_sent` (medication, revision, kind, person) have unique indexes and each reminder is **claimed with `INSERT ... ON CONFLICT DO NOTHING` before it is sent**, so a retry or a second worker cannot double-send. The job runs in one transaction, so a failure rolls the claim back and the next scan retries.

## Access

Everything follows the health ACL on the person's `medications` segment: `read` sees, `write` changes. Organizers, appointments, sessions and refills require it; private medications are filtered per viewer (no admin override); a revoked caregiver is refused on the next request and drops out of reminders on the next scan. The full matrix is in [HOSTED_TENANT_TESTS.md](./HOSTED_TENANT_TESTS.md), the tables in [HOSTED_RLS.md](./HOSTED_RLS.md).

## Limits

| Limit | Value | Error |
|-------|-------|-------|
| Pharmacies per household (archived count) | 100 | 409 `too_many_pharmacies` |
| Compartments per plan | 8 | 409 `too_many_compartments` |
| Filling sessions kept per person | 60 | 409 `too_many_sessions` |
| Fill appointments listed ahead of today | 12 (the list stops there) | none |
| Fill length | 1 to 93 days | 400 |
| Pill quantity | ¼ to 100 per dose | 400 |
| Supply | 3650 days | 400 `supply_too_large` |
| Lead time | 0 to 90 days | 400 |

The per-household caps take a transaction-scoped advisory lock (`lockQuota`) before counting, like the health check caps.

## Architecture notes

- **Pure logic** lives in `packages/calendar-sync` so the API and the worker share it: `health-organizer-placements` (which dose goes where, on which day), `health-supply-arithmetic`, `health-organizer-occurrences`, `health-organizer-session-logic` (progress, next start day, diffs), `health-supply-reminder-plan`.
- **Visibility:** nothing here widens health access; the worker's cross-household reach is limited to the scheduler's tick (`health_organizer_plans`, `health_medication_supply`). See HOSTED_RLS.md.
- **The tenant middleware wraps each request in one transaction**, so an early 409 does not roll back writes made before it; routes that can fail after writing use `ON CONFLICT DO NOTHING` and re-select instead of relying on an exception.

### Code map

| Area | Files |
|------|-------|
| Tables | `packages/db/src/schema/health.ts`, migrations 0087 to 0091 |
| Routes | `apps/api/src/routes/health-pharmacies.ts`, `health-supply.ts`, `health-refills.ts`, `health-organizers.ts`, `health-organizer-appointments.ts`, `health-organizer-sessions.ts` |
| API libs | `lib/health-supply.ts`, `health-organizer-plan.ts`, `health-organizer-session.ts`, `health-organizer-appointments.ts`, `health-organizer-validation.ts`, `health-quota.ts`, `health-supply-glance.ts`, `calendar-overlays.ts` (`buildSupplyOverlays`) |
| Reminders | `packages/calendar-sync/src/health-supply-reminder-scan.ts`, `health-supply-reminder-plan.ts`, `health-reminder-fanout.ts`, `household-scan-fanout.ts`, dispatch in `sync.ts` |
| Web | `components/health/`: `PharmaciesSection`, `SuppliesSection`, `SupplySheet`, `OrganizerSection`, `OrganizerSheet` (+ step components), `FillingSheet` (+ `FillingMedicationPanel`, `FillingMedicationPicker`, `FillingReviewBanner`, `FillingSummary`, `CompartmentDiagram`), `AppointmentSheet`, `OrganizerAppointments`; helpers `*-helpers.ts`; `calendar/EventKindIcon.tsx`, `lib/calendar-utils.ts`, `lib/health-glance-tile.ts` |

## Tests

- Database: `packages/db/src/health-supply-isolation`, `health-organizer-isolation` and `health-supply-reminders-isolation` `.integration.test.ts`, `rls-worker-scan-coverage.integration.test.ts`.
- API (run as the non-superuser app role): the six `routes/health-*.integration.test.ts` files above, `lib/calendar-supply-overlays.integration.test.ts`.
- Worker: `health-supply-reminder-scan.integration.test.ts`, `health-supply-reminder-fanout.integration.test.ts`, `health-supply-reminder-plan.test.ts` (injected clock, several time zones).
- Unit: the calendar-sync logic modules and the web helper modules each have a `.test.ts` beside them. Mutation testing was used throughout: a test that still passes with the code under test broken proved nothing.

## Troubleshooting

- **No reminder arrived:** is the estimate waiting to be confirmed after a pause? Was the refill requested? Is the medication paused or past its end date? Is the person a selected caregiver, and do they still have medications read (and see that medication)? Was it already sent (check the sent tables)? Inbox first, push needs their health reminders setting and a device.
- **Run-out date looks wrong:** it is `today` plus the organizer's unbroken filled days plus the days outside; a gap in what the organizers cover asks for the total in hand instead.
- **"Review required" keeps showing:** something in the instructions changed since the session started (a quantity, the schedule, a compartment name). Take the new instructions.
- **Typechecking the API or worker:** `npm run build` in `packages/db` and `packages/calendar-sync` first; they resolve from `dist`.

## Known gaps

- Medications left unfilled when a session ends are not offered in the next one. The person is asked at finish and stop (WHO-444) and chooses; there is no catch-up flow by design (WHO-440).
- A medication taken only on some weekdays is placed correctly (unit tested) but the QA pass did not click it.
- Supply is an estimate: nothing reads dose logs, so a person who takes extra or skips doses has to update it.
- Real push delivery and the BullMQ tick are covered by stubs at the boundary, not end to end in CI.
