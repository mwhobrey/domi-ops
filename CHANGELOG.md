# Changelog

All notable changes to Domi Ops are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) — see [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

This file starts tracking from 2026-08-30. Earlier history lives in `git log` and closed Linear issues.

## [Unreleased]

### Added

- **Excuse a student from an assignment** (WHO-335): on School → Overdue, each student who
  still owes the work has an **Excuse** button, and the assignment page's Student work panel
  has **Excuse / Un-excuse**. Excused work isn't missing or overdue, stays out of averages, and
  sends no reminders. Work a student already turned in can't be excused. *(requires
  `npm run db:migrate` (`0078_submission_excused`); no other manual steps.)*
- **Recurring bills** on the Expenses page (WHO-334): add rent, subscriptions, or insurance
  once (weekly, every 2 weeks, monthly, every 3 months, or yearly) and each one posts to
  expenses on its due date, in the household's time zone, counting toward budgets. Bills can
  be edited, paused, or removed; posted expenses carry a "Bill" tag and stay when a bill is
  removed. The section shows what's due in the next 30 days. *(requires `npm run db:migrate`
  (`0077_expense_recurring`); no other manual steps.)*
- Calendar events (WHO-330):
  - Repeat **yearly** (birthdays, anniversaries), **every N** days/weeks/months/years, and end
    the repeat on a date or after a number of times.
  - A **Location** field, synced with Google Calendar both ways.
  - **Who's it for**: tag household members on an event. The agenda shows them, and the
    calendar toolbar can filter to one person's events.
  *(requires `npm run db:migrate` (`0076_calendar_event_location_attendees`); no other manual
  steps.)*

- Goals & Rewards (WHO-333):
  - Goals can say what they count ("books", "miles") and carry an optional target date;
    progress reads "12 / 20 books · Target Dec 31". *(requires `npm run db:migrate`
    (`0075_goal_unit_target_date`); no other manual steps.)*
  - Owners and admins can create a reward right from a milestone's reward picker instead of
    leaving the goal form for the Rewards tab.
  - A **Goals** report in Reports: goals in progress and completed, progress per goal, and
    reward claims with their status. Exportable like the other reports.

### Changed

- "Today" everywhere in the app is the household's day, not your device's (WHO-336): due
  labels, overdue counts, default dates on new events, expenses, and bills, the calendar's today
  highlight and current-time line, and weekly report ranges. Nothing changes when your device
  and household share a timezone; a member traveling in another zone now sees the same day as
  the chores, shopping, and bills the server posts.
- School overdue triage (WHO-335): **School → Overdue** and the dashboard School tile count
  work per student, using the gradebook's rules. Anything turned in, graded, or closed is no
  longer "overdue", and each row says which students still owe it. Teachers and admins can
  select overdue assignments and **Close** them in bulk to clear stale work.
- Faster page loads (WHO-335): the rich-text editor, the markdown renderer, and the Sentry SDK
  now load only when a page needs them, instead of on every page. JavaScript per page drops
  about 70%: the dashboard from ~394 KB to ~122 KB gzipped, and the sign-in page from ~341 KB
  to ~71 KB.
- Calendar recurring events (WHO-330): "every 2 weeks" no longer drifts off its week when the
  calendar catches up, "repeat 5 times" stops at 5, and a monthly event on the 31st skips
  shorter months instead of sliding to the 3rd. Overnight and multi-day repeating events keep
  their length on every occurrence instead of all ending on the first one's end date.
- Editing a Google-synced event's title or location now pushes to Google, not just time
  changes (WHO-330).
- Weekly reports cover the whole week (Mon–Sun) instead of stopping at Friday, which
  silently dropped anything due on a weekend (WHO-333).
- Expenses: the add-expense row says "Spent by …" for the member picker and shows `$` on the
  amount (WHO-333).
- Recurring chores no longer stay stuck on a date that passed months ago (WHO-328). When a
  chore's next occurrence arrives while the current one is still open, it moves to the latest
  occurrence and counts the ones that passed ("Missed 3×"). A daily chore is at most a day
  overdue; a weekly one stays overdue until the next week's occurrence. *(requires
  `npm run db:migrate` (`0074_chore_missed_count`); no other manual steps.)*
- Chores: "Redemption quest" is now **Catch-up bonus** (same karma, with a tooltip), and the
  overdue push reads "Chore overdue". Due dates read "Due today", "Due Fri, Sep 25", or
  "Overdue · Tue, Jul 7" instead of `2026-07-07`; the assignee shows with a person icon and
  tags render as `#tag`, so tags, people, and status no longer look alike (WHO-328).
- Calendar polish (WHO-329):
  - The desktop month view shows up to three event titles per day, with times and colors,
    plus "+N more". Smaller month views show a real count instead of a "•••" capped at three.
  - Week and day views highlight today's column and draw a current-time line.
  - Health entries on the calendar render as short markers instead of hour-long blocks, and
    vitals read "Vitals · 135/90 · HR 65" instead of "BP systolic, BP diastolic, Heart rate".
  - New event form: a real time-zone picker instead of a free-text box, color swatches, a
    labeled Repeat control, and new events start in the calendar's default category.
- Polish from the dogfood walkthrough (WHO-332):
  - Drive:
    - The upload / add-link form is tucked behind a button, so files are what you see first.
      Drag-and-drop still works anywhere on the page.
    - Files pinned inside folders show in a "Pinned in folders" strip at the Drive root.
    - A folder with subfolders but no files no longer says "Drive is empty".
  - Shopping:
    - Adding an item is always visible instead of hidden behind "Add item".
    - The cart's button reads "Done shopping", which saves the trip.
  - Notices:
    - The panel opens on whichever tab has the unread items.
    - Reminder alerts for things more than 12 hours past no longer keep the badge lit.
    - Calendar reminders read "starts in 3 hours" instead of "3 hour(s)".
    - Same-day medication reminders show just the time instead of the full date and year.
  - Timestamps across Notes, Drive, Goals, and calendar sync status read "Sep 22, 5:23 PM"
    instead of including seconds. They're also formatted in the browser, which removes a
    source of hydration errors.
  - Settings → Integrations flags Google Calendar sync as "Sync stalled" after two days
    without a successful sync, instead of silently showing a months-old "Last sync".
  - Profile: the delete-account section moved to the bottom of the page.
- Health, from the dogfood walkthrough (WHO-331):
  - The dashboard Health tile says whose dose it is ("Lunch Meds · Ally") when it isn't yours.
  - Past-due doses on the Health Today tab are marked **Overdue** with a red border, matching
    the dashboard.
  - Trends shows blood pressure as one chart with systolic and diastolic lines. Vitals charts
    scale the Y axis to the data, so SpO₂ at 97–99% isn't a flat line at the top of a 0–100
    axis, and a date with several readings is labeled once.
  - The Log tab now includes scheduled dose logs ("Took Effexor · Dose"), interleaved by time
    with health events. Before, it only showed as-needed doses, which create their own "Took"
    events. Nothing is migrated; the Log reads both.
  - Vitals entries read "Vitals" with a compact summary ("BP 135/90 · HR 65 · SpO₂ 98%")
    instead of "BP systolic, BP diastolic, Heart rate" and a long label list.
### Fixed

- Medications in a group can be edited again from the Medications tab. Each group card lists
  its meds with dosage, schedule, and an Edit button; the WHO-302 merge had left them as
  plain labels, reachable only through a notification deep link (WHO-337).
- A malformed id in an API request (e.g. `/api/calendar/events/not-a-uuid`, or a bad
  `calendarId` on create or move) returns 400 `invalid_input` instead of a 500 (WHO-336).
- **Editing a calendar event wiped its drive buffers** (WHO-336). The calendar dropped the
  buffer minutes when loading events, so the edit sheet showed them empty and saving cleared
  them. The same drop hid event locations and "who it's for" and broke the member filter.
- **Expenses flooded the server with requests** (WHO-336): the category field re-queried
  suggestions after every response, about 120 requests in a few seconds on `/expenses`. The same
  field on chores, shopping, and bills is fixed too.
- School assignment page: the Due badge read "DueMon, Sep 21" (a missing space since the
  hydration fix), and an excused student showed as "turned in" and "Overdue" (WHO-335).
- Phone layout: two- and three-column report tables no longer scroll sideways, and the goal
  sheet's "Add reward" button no longer wraps onto two lines (WHO-335).
- School dates on the class, gradebook, assignment, and reports pages no longer render in UTC
  on the server and then flip to local time, which caused React hydration errors (WHO-335).
- The School API's assignment, material, and upload routes now return 403 when the School
  module is off for the household, like the class routes already did (WHO-335).
- Expenses reject a malformed date instead of storing it (WHO-334).
- **Calendar event permissions (WHO-330):** editing, deleting, or duplicating an event now
  requires write access to its calendar. Before, a household member with an event's id could
  change or delete events on someone else's private calendar, and an edit could overwrite
  internal fields (including the event's household) or move it to a calendar they can't write.
- The "Set up your household calendar" banner no longer flashes on every Calendar page load
  while calendars are still loading, and the page no longer fetches events twice on open
  (WHO-329).
- Settings showed "0 B used" for Drive storage on installs that imported HomeHub files. The
  importer stored every file as 0 bytes with a generic content type and never counted it
  toward the quota. New imports record real sizes. *(Installs that already imported: run
  `node packages/import-homehub/scripts/backfill-file-sizes.mjs` once. See
  `.cursor/runbook/04_CURRENT_STATE.md`. No migration.)* (WHO-332)
- Health Trends no longer plots different household members' vitals on one line (WHO-327). The
  Trends tab has a Member picker (defaults to you), and the health report's "All members" view
  now keeps each person's readings in their own labeled series.
- Dates now follow the household timezone instead of the server's UTC clock (WHO-327):
  recurring chores and shopping items no longer appear a day early in the evening, a chore
  finished on its due date after 7 PM Central no longer counts as late, expense budgets no
  longer roll into next month early on the last evening of a month, and the School overdue /
  due-this-week list shows due times in local time (it could previously show the wrong day). In
  the browser, the dashboard's "today" (which showed tomorrow's calendar events after 7 PM
  Central), chore overdue flags, the default expense date, and report date ranges use your local
  date instead of UTC.
- Event times on the dashboard Calendar tile, Today's schedule, and the calendar Agenda view
  now read "6:00 PM" instead of raw values like `18:00:00` (WHO-327).
- Bulleted and numbered lists in notes, notices, and event descriptions render their bullets
  and numbers again (WHO-327).
- Goals can be chosen in Profile → Dashboard tiles; previously, saving any tile preference hid
  the Goals tile permanently (WHO-327).

## [0.3.0] - 2026-09-23

### Added

- **Goals & Rewards module** (WHO-322): new optional household module — creator-defined ordered
  milestones per goal (threshold + title + optional linked reward; the final milestone is the
  goal's completion, no separate target field), manual progress logging (amount + note), and a
  household reward catalog with claim → owner/admin approve/deny redemption flow. `/goals` page
  with Goals / Rewards / Approvals tabs; dashboard glance tile. Auto-progress from chores/health/
  school is a follow-up (WHO-323/324/325) — this phase only wires `sourceType: "manual"`, but the
  schema already reserves `sourceType`/`sourceEventType` for them. *(requires `npm run db:migrate`
  (`0073_goals_rewards`); self-hosters get the module on by default via `MODULES_ENABLED`.)*
- Health OTC medications (WHO-319): new schedule kind **`otc`** — as-needed logging like PRN
  (`scheduled_at` null), Today quick-log inclusion, no fixed dose slots. Requires
  `npm run db:migrate` (`0072_med_schedule_otc`).
- Browser + Next.js server Sentry for `apps/web` (`@sentry/nextjs`, WHO-292) — reuses
  runtime `SENTRY_DSN` on the web container; `error.tsx` / `global-error.tsx` report to Sentry.
- Customizable dashboard layout (WHO-313 / WHO-314): each member can drag the section cards
  (glance, schedule, weather, conflict checker, household, month calendar) into their
  own order from **Customize** on the Dashboard title row, pick a 1/2/3 column grid, and
  resize a card across those columns. Saved per member; default 2-col order is unchanged
  until they rearrange. *(WHO-313 requires `npm run db:migrate`; WHO-314 reuses that column.)*
- Capacitor 8 store shell (`apps/mobile`, `appId: app.domiops`) with Bitwarden-style server URL
  picker, `/api/healthz` probe (CapacitorHttp), and remote WebView of live `apps/web` (ADR 005 /
  WHO-287). Native Google + Sign in with Apple idToken exchange, APNs/FCM push (FCM HTTP v1),
  RevenueCat → `household_subscriptions`, Profile account deletion for store compliance
  (WHO-288–291). See `docs/native-mobile-store-spike.md` and `store-assets/CHECKLIST.md`.
- Medication reminder groups: bundle several household medications under one shared schedule so
  recipients get a single consolidated push notification instead of one per medication, plus a
  dedicated `/health/medications` manager page.
- Per-route `loading.tsx` skeletons across the app, matching each page's real layout to avoid a
  layout jump when the real content streams in.
- Issue templates, PR template, Code of Conduct, and this changelog.
- Event type filter on the Health Events tab, matching the filter already available on the
  Events report — previously the only way to narrow the feed by type (WHO-294).
- Exercise and pain tracking in the Health module (WHO-297/298/299): dedicated "Log exercise"
  and "Log pain" quick-log buttons alongside the existing "Log vitals", each opening a
  purpose-built sheet — pain logging taps a front/back body map instead of typing a location.
  Both types are also fully editable via the general "Add event" form for backdating, same as
  vitals already was.
- Exercise and pain report kinds (WHO-301): "Exercise" shows weekly workout volume and a
  by-activity minutes breakdown; "Pain" shows a body-region frequency heatmap (reusing the
  `BodyPainMap` diagram in read-only mode) and severity-over-time per region. Both are
  selectable from the Health reports picker and support the same print/CSV/JSON/YAML export
  as every other health report.
- Schedule Conflict Checker (WHO-308): a dashboard widget that checks a date/time (or range)
  for overlapping calendar events and medication doses due in that window. Overlapping events
  are flagged red; events whose own manually-entered drive-time buffer encroaches on the
  checked window are flagged yellow; meds due in the window are shown as informational only.
  New optional per-event `driveBufferBeforeMinutes`/`driveBufferAfterMinutes` fields (manual
  entry — no maps/geocoding integration, whole minutes from 0 to 1440) are editable from the
  event sheet's "Drive buffer" section and used automatically when that event is checked.
  Buffers aren't supported on recurring events yet. New `GET
  /api/schedule-conflicts/check` endpoint. *(requires `npm run db:migrate`; no other manual
  steps for self-hosters.)*
- Schedule conflict checker ↔ calendar integration (WHO-309): the **New event** sheet can run
  the checker pre-filled from the in-progress date/time/duration (and drive buffers); dashboard
  checker results include **Create event with this time**, which opens `/calendar` with the
  checked window and ad-hoc buffer copied into the create form.

### Changed

- Calendar event create/edit: changing the start time on a timed event now moves the end time
  to one hour later when the end was still the default (or invalid); custom durations are
  preserved when the end was set manually.
- Pain body map (WHO-312): the front chest is now split into left and right so a side can be
  selected, and the back view has a spine region down the middle. The old single `chest` region
  is no longer selectable; existing entries keep their "Chest" label in lists and reports but
  aren't drawn on the map. *(requires `npm run db:migrate`; no other manual steps for
  self-hosters.)*
- Health Events tab renamed to Log, with the type dropdown replaced by filter chips that only
  show types you've actually logged, instead of all nine every time (WHO-300).
- Medication editing consolidated to one place: the Health Medications tab is now the full
  manager (groups, day timeline, schedule editor) instead of a separate quick-edit list that
  linked out to `/health/medications` for anything more. That page is now a redirect back to
  `/health` (WHO-302).
- New Health **Trends** tab: vitals, exercise, and pain charts inline on `/health` instead of
  only in Reports — the same "is BP trending up" gap now closed for exercise volume and pain
  severity too (WHO-303).
- Nutrition tracking: a `food_intake` health event type with one or more food entries per meal
  (name, quantity, calories, protein/carbs/fat) — manual entry only, no food database. Dedicated
  "Log meal" quick-log button alongside Log vitals/exercise/pain, plus full editing via the
  generic "Add event" form for backdating (WHO-304/305). New "Nutrition" report kind (daily
  calorie trend + protein/carbs/fat breakdown) in both the Reports hub and the Health Trends tab
  — same running-totals treatment as vitals/exercise/pain, not just a food journal (WHO-306).
  This closes out Phase 3 of the Health module expansion.
- Split several large files (`apps/api/src/routes/core.ts`, `apps/api/src/routes/school.ts`,
  `HealthPageClient.tsx`, `SchoolClassDetail.tsx`) into focused modules for maintainability.
- Health Today tab's "Logged today" list is now grouped by household member with a collapsible
  header, matching the grouping "Scheduled doses" already had (WHO-295).
- PRN meds on the Health Today tab moved from a card at the bottom of the page to a searchable
  quick-log at the top — type or tap a med to log an as-needed dose in one action instead of
  scrolling past the scheduled dose queue to reach it (WHO-296).

### Fixed

- Health log sheets' "Share with" picker now tracks who you're actually logging for (WHO-326):
  switching the Member dropdown (vitals/exercise/pain/meal/event/medication) no longer leaves the
  previous subject offered — or, if already checked, silently retained — as a share target once
  they become the record's subject. `NoteSharePicker` gained an `excludeMemberIds` prop and prunes
  a now-redundant selection instead of submitting it.
- Dashboard Customize drag no longer scales a small card up to the Today at a glance height
  (WHO-314): the overlay is a compact label, and sortable transforms are translate-only.
- Interval medications with a multi-day cadence (e.g. once every 7 days) no longer reappear every
  morning at the start time; next dose is last taken + interval across days
  (`packages/calendar-sync/src/med-interval-schedule.ts`).
- Calendar med overlays prefer medication **groups** over member meds, omit already-logged doses,
  and keep overdue untaken doses. At-a-glance calendar tile no longer lists meds (health tile does)
  and hides past timed events; dashboard agenda hides past timed events.
- The `/health` page was unreachable in production due to a Caddy routing rule that shadowed it
  with the API's own liveness endpoint.
- Scroll jank on iOS (Safari and Chrome, both WebKit): dropped `backdrop-filter` from the sticky
  header, calendar toolbar, calendar agenda day headers, health sharing bottom bar, and the drive
  drag-and-drop overlay, since WebKit recomputes the blur every scroll frame instead of caching it.
- Hosted checkout no longer forks a signed-in user's account: a signed-in user who finishes
  checkout is attached to their household by their session identity, not the email typed into
  Stripe Checkout, and a repeat checkout by someone who already has a household is sent to the app
  instead of creating a second subscription. A mismatch between the login and the Checkout email
  used to spawn a second account and household that could never reach the app.
- A household member with write access to another member's private health events/medications —
  not just the record's creator — no longer silently clears its shares when editing and saving.
  The API previously only returned real share state to the creator; a non-creator editor saw an
  empty share list and unknowingly overwrote it on save (WHO-293).
- The Health Events "Event type" filter (report + tab) silently dropped Exercise/Pain since
  neither was in the type-label map the filter validates against; both were also missing from
  the report filter's own dropdown options.
