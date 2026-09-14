# Med reminder delay — spec

Adds a "delay" (a.k.a. snooze) action to health medication reminders, grounded in the actual reminder pipeline as it exists today. Supersedes an earlier draft of this doc that assumed local device notifications — Domi Ops reminders are server-scanned Web Push, and the design below is built around that.

## How med reminders work today (for context)

- `packages/calendar-sync/src/health-med-reminder-scan.ts` (`scanHealthMedReminders`) runs as a BullMQ repeatable job every 5 minutes (`ensureHealthMedReminderScheduler`, `queue.ts`). Each pass looks at a 6-minute forward window and a 30-minute lookback (`WINDOW_MS` / `LOOKBACK_MS`) and fires a Web Push notification for any dose whose fire time (`scheduledAt - offsetMinutes`) falls in that ~36-minute band.
- Delivery is deduped through `health_med_reminder_sent` / `health_med_group_reminder_sent` — a unique index on `(medicationId|groupId, scheduledAt, offsetMinutes, subscriptionId|userId)`. Each dose/offset combo fires **exactly once**, ever. There's no re-notify and no missed-dose escalation (this is also the root of the WHO-142 lookback-window bug already in the backlog — a worker outage means a dose silently never gets reminded).
- The push includes `Taken`/`Skip` action buttons (`MED_PUSH_ACTIONS` in `health-med-reminder-scan.ts`) wired to a signed, short-lived (4h) HMAC token (`mintHealthMedPushActionToken` / `mintHealthMedGroupPushActionToken` in `packages/crypto/src/index.ts`). The service worker's `notificationclick` handler (`apps/web/public/sw.js`) posts the token straight to `POST /api/health/medications/push-action` (or the group equivalent) without opening the app, so action buttons work even if the app isn't in the foreground.
- That endpoint calls `recordDose()` (`apps/api/src/lib/health-med-logging.ts`), the single writer of `health_medication_logs`, which is unique-indexed on `(medicationId, scheduledAt)`.
- Meds are `scheduled` (fixed `times[]` + optional `daysOfWeek`) or `interval` (next dose = last `taken` log + `everyMinutes`, computed in `med-interval-schedule.ts`). For interval meds, the "next dose" clock only advances on an actual `taken` log — it does not advance just because time passed.

Net effect today: ignore a reminder and nothing happens again. That's the gap "delay" fills — not "recover a missed dose" so much as "yes I saw it, ask me again in a bit."

## Design

### Keep "delay" out of the dose-status vocabulary

`HealthMedPushActionStatus` (`packages/crypto/src/index.ts`) is explicitly `"taken" | "skipped"`, and every consumer downstream — `recordDose`, `medLogStatusEnum` in the DB, the `/push-action` routes — treats it as a dose outcome. A delay isn't a dose outcome, it's "don't ask now, ask again at T+Δ," and the dose stays unlogged. Don't add `"delay"` to that union — it would either get filtered out by `verifyHealthMedHmacToken`'s existing `actions.filter(a => a === "taken" || a === "skipped")` guard, or (worse) someone routes it through `recordDose` later and now there's a phantom "delayed" dose status nothing else expects.

Instead: a parallel token kind and a parallel table, following the same dual-shape convention the codebase already uses for med vs. group (`healthMedReminderSent` / `healthMedGroupReminderSent`).

### New tables

```ts
// packages/db/src/schema/health.ts — new, alongside healthMedReminderSent

export const healthMedReminderDelays = pgTable("health_med_reminder_delays", {
  id: uuid("id").primaryKey().defaultRandom(),
  medicationId: uuid("medication_id").notNull().references(() => healthMedications.id, { onDelete: "cascade" }),
  originalScheduledAt: timestamp("original_scheduled_at", { withTimezone: true }).notNull(),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  delayMinutes: integer("delay_minutes").notNull(),
  delayUntil: timestamp("delay_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }), // null until the follow-up push actually fires
});
// + health_med_group_reminder_delays, same shape with groupId instead of medicationId
```

`delayUntil` is computed server-side (`requestTime + delayMinutes`) — never trust a client-supplied timestamp for when to re-fire. Index `(medicationId, originalScheduledAt)` — the cap checks below query on it.

### New action + token, not a third dose status

Mirror `mintHealthMedPushActionToken`/`verifyHealthMedPushActionToken` with a `mintHealthMedDelayActionToken` / `verifyHealthMedDelayActionToken` pair (same HMAC/claims scaffolding in `packages/crypto/src/index.ts`, same `HealthMedPushActionClaimsBase` fields minus `actions`). Claims: `{ householdId, userId, medicationId, scheduledAt, exp }`. New routes, registered before `requireAuth` the same way `/push-action` is (the token carries its own auth):

- `POST /api/health/medications/delay-action` — parallel to `household-health.ts`'s existing `/medications/push-action`.
- `POST /api/health/medication-groups/delay-action` — parallel to `health-medication-groups.ts`'s `/push-action`.

Request body: `{ token, delayMinutes }`, where `delayMinutes` is checked against a small server-side allowlist (e.g. `[15, 30, 60]`) — don't trust an arbitrary client-supplied integer.

Handler, once the token verifies and dose-write access is confirmed (same `hasHealthSegmentAccess(..., "doses", "write")` check the existing actions use):

1. **409 if already logged** — if `health_medication_logs` already has a row for `(medicationId, scheduledAt)`, reject. Can't delay a dose that's already taken/skipped.
2. **Cap delay count** — count existing `health_med_reminder_delays` rows for `(medicationId, originalScheduledAt)`. Reject past some max (suggest **2**). A med someone keeps deferring isn't being "delayed" anymore, it's being skipped one tap at a time — force that into an explicit decision rather than an infinite soft-no.
3. **Cap total delay** — reject if `now + delayMinutes` would land more than some ceiling (suggest **2 hours**) past `originalScheduledAt`, independent of the count cap above (catches "one big delay" as well as "many small ones").
4. **Collision with the next dose** — for `scheduleKind: "scheduled"`, look at the med's own `times[]` (or the group's) for the next later time-of-day that same day; clamp or reject if `delayUntil` would land on/after it, so you don't end up with two live "8am dose" reminders for the same med at once. **Interval meds don't need this check** — their next-dose clock only advances on an actual `taken` log (see above), so delaying a still-unlogged interval dose can't create a double-fire.
5. Insert the delay row, return `{ delayUntil }` so the caller can confirm ("reminding you again at 3:15pm").

### Scan changes

Add a second pass in `scanHealthMedReminders` (or a small sibling function called from the same job) that, per household, queries `health_med_reminder_delays` / `health_med_group_reminder_delays` where `sentAt IS NULL` and `delayUntil` falls in the same `[now - LOOKBACK_MS, now + WINDOW_MS]` band the existing offset loop uses — reusing the constant is a deliberate choice for consistency, though it does mean a delay inherits the same WHO-142 worker-outage gap already on the backlog rather than introducing a new one.

For each due delay row:
- Skip (still stamp `sentAt`, no push) if a `health_medication_logs` row now exists for `(medicationId, originalScheduledAt)` — the dose got logged some other way (in-app, a group "take all") while the delay was pending. Firing a reminder for an already-resolved dose is exactly the "did I take it twice" confusion worth avoiding.
- Otherwise send via the same push-delivery path `deliverOneMedReminder` uses, with its own tag (`health-med-delay-${delayRow.id}`, distinct from the offset-keyed tags so it can't collide with `healthMedReminderSent`'s dedupe) and body copy that reads as a delayed reminder rather than a fresh one ("You delayed this — [med] was due at [original time]") so it's visually distinguishable from the original.
- Mark `sentAt`.

No cancellation flow needed beyond the "already logged" check above — a delay row that never gets to fire because the dose was logged first just sits there harmlessly (or gets cleaned up on a schedule later if the table grows).

### Push action buttons — a real constraint, not just plumbing

`MED_PUSH_ACTIONS` today is exactly two entries (`Taken`, `Skip`). The Notification API's `actions` array is capped by the browser — Chrome/Android reliably renders 2, more are accepted but often not shown; iOS Safari web push (16.4+) is similarly tight. **Adding a third always-visible "Delay" button risks silently not rendering on some platforms** — worth deciding rather than assuming:

- **Option A** — replace `Skip` with `Delay 1h` as the second button, and leave `Skip` reachable only from the in-app `/health` page. Reasoning: for most meds, "not yet, ask me later" is a more common lockscreen action than "skip entirely," and skip is arguably a decision worth making inside the app anyway.
- **Option B** — keep both existing buttons, and make delay a deep-link-only flow (tapping the notification body, not an action button, opens `/health?...` with a delay picker there).

**Decided: Option A.** `sw.js`'s `notificationclick` handler needs a third branch — `action === "delay"` posts `{ token, delayMinutes: 60 }` to the new endpoint, mirroring the existing `postMedPushAction` pattern, with the same offline fallback to `openAppPath` on failure that `taken`/`skip` already have. `MED_PUSH_ACTIONS` in `health-med-reminder-scan.ts` becomes `[{ action: "taken", title: "Taken" }, { action: "delay", title: "Delay 1h" }]`, and `Skip` moves to a button inside the `/health` page instead of a push action.

### Group notification click routing — fixed

Confirmed and fixed (in `apps/web/public/sw.js`, committed to the repo): the `notificationclick` handler was always posting to the singular `/api/health/medications/push-action` endpoint regardless of whether the notification was for a single med or a group. A group reminder carries `data.medicationGroupId` (not `data.medicationId`) and was signed with `mintHealthMedGroupPushActionToken`'s claims shape, which has no `medicationId` field — so `verifyHealthMedPushActionToken`'s `checkSubject` (`typeof raw.medicationId === "string"`) always failed for those tokens, and every group `Taken`/`Skip` tap was silently falling through to the offline deep-link fallback instead of actually logging the dose.

Fix applied: `postMedPushAction` now takes the full `data` object and picks the endpoint by which id is present — `/api/health/medication-groups/push-action` when `data.medicationGroupId` is set, `/api/health/medications/push-action` otherwise (that route path is confirmed from `apps/api/src/index.ts`: `app.route("/api/health/medication-groups", healthMedicationGroupRoutes(db, env))`). `medActionFallbackUrl` and the `domi-ops:med-logged` postMessage now also carry `medicationGroupId` for the group case, so the offline fallback and any client-side listener have the right id instead of silently dropping it.

Worth testing once meds groups exist in your household data — this had presumably been broken since group push actions shipped, so a "Morning meds" group reminder's `Taken` button is worth a manual tap-through to confirm the fix actually logs the dose now.

### In-app entry point

The `/health` page (wherever the med detail/glance UI renders reminders) should get its own delay picker — 15/30/60 presets plus custom — for anyone opening the app directly instead of tapping a push action. Same endpoint, same caps; the picker is just a second way to hit `POST /api/health/.../delay-action`.

### Groups

Everything above mirrors onto `health_med_group_reminder_delays` and the group's `/push-action`-parallel route, following the exact pattern `health-medication-groups.ts` already uses for `Taken`/`Skip` — group delay caps and collision checks work the same way, keyed by `(groupId, originalScheduledAt)` instead of medication.

## Open questions for you

- Confirm the delay-count cap (suggested 2) and total-delay cap (suggested 2h) — these are guesses at what's sane for meds, not derived from anything in the code.
