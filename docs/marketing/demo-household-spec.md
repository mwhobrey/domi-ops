# Demo household — seed data & nightly playground

| Field | Value |
|-------|-------|
| **Linear** | WHO-190 (to be created) |
| **Blocks** | [WHO-134](https://linear.app/mikewhob-whome/issue/WHO-134) hero screenshots, `demo.domi-ops.com` marketing |
| **Status** | Spec only — not implemented |

## Goals

1. **Marketing screenshots** — repeatable, polished UI states without dogfood PII.
2. **Public demo playground** — `demo.domi-ops.com` (or `app.domi-ops.com/demo`) with shared login, **wiped and re-seeded nightly**.
3. **Local dev** — `npm run db:seed-demo` after migrate for designers/devs.
4. **Screenshot capture** — `npm run marketing:capture-screenshots` (Playwright; app must be running).

All dates/times must be **relative to seed execution** (`today`, `today+3`, `startOfWeek+1`) so calendar week view and dashboard glances stay fresh after nightly reset.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  packages/db/src/seed-demo.ts                           │
│  - wipeDemoHousehold()  (idempotent by household slug)    │
│  - seedDemoHousehold()  (Drizzle inserts, all modules)  │
└─────────────────────────────────────────────────────────┘
         ▲                          ▲
         │                          │
  npm run db:seed-demo        cron / worker job
  (local, CI artifact)        DEMO_RESET_CRON=0 4 * * *
```

| Env | Purpose |
|-----|---------|
| `DEMO_MODE=true` | Deployment is demo-only; refuse non-demo sign-up; show banner |
| `DEMO_HOUSEHOLD_SLUG=rivera-demo` | Stable slug for wipe targeting |
| `DEMO_OWNER_EMAIL=demo@domi-ops.com` | Shared login (documented on marketing site) |
| `DEMO_OWNER_PASSWORD` | Set in demo deploy `.env` only — never commit |
| `DEMO_RESET_ENABLED=true` | Allow scheduled reset job |
| `ALLOW_PUBLIC_SIGNUP=false` | Still off; demo users are seeded, not self-registered |

**Nightly reset job** (pick one at implement time):

- **A (simple):** Host cron → `docker compose exec api node /app/packages/db/dist/seed-demo.js --reset`
- **B:** BullMQ repeatable job in worker (`demo.reset` queue)

Reset steps: flush demo household data (or truncate household-scoped tables by `household_id`), re-run seed, flush Redis queues for that household, optional MinIO prefix wipe `drive/{householdId}/*`.

**Safety:** `seed-demo` aborts unless `DEMO_MODE=true` OR `NODE_ENV=development` OR `--force` with confirmation prompt.

---

## Fictional household: **Rivera Family**

Generic, homeschool-friendly, no real PII. Chicago timezone (matches common US demo).

### Members

| Display | Role | Username | Presence | Use in UI |
|---------|------|----------|----------|-----------|
| **Maria Rivera** | owner | `maria` | Home | Calendar color, notice author |
| **James Rivera** | admin | `james` | Away | Second adult |
| **Sofia Rivera** | child | `sofia` | Home | School student, chores |
| **Lucas Rivera** | child | `lucas` | Home | School student, younger |

**Demo login (playground only):** `demo@domi-ops.com` → maps to Maria (owner). Optional read-only child session docs for QA — not required v1.

All members have display names and avatar placeholders (initials fallback OK for v1).

### Modules enabled

`core`, `school`, `calendar_sync`, `drive`, `health` — full grid for marketing.

---

## Per-module seed content

### Dashboard (`/dashboard`) — hero alternate

| Widget | Seed |
|--------|------|
| Weather | Chicago coords via household/user prefs (or env default) |
| Presence | Maria + Sofia + Lucas Home; James Away |
| Notice board | Pin: "Co-op Thursday — bring lunch" (Maria) |
| Chores glance | 2 due today, 1 overdue |
| School glance | 1 assignment due tomorrow |
| Month mini-calendar | 3+ events this week |

### Calendar (`/calendar`) — **primary hero screenshot**

**Week view, current week:**

| Event | Day | Time | Notes |
|-------|-----|------|-------|
| Piano lesson | Tue | 4:00 PM | Sofia, timed |
| Soccer practice | Wed | 5:30 PM | Lucas, timed |
| Homeschool co-op | Thu | all-day | household |
| Dentist — Sofia | Fri | 10:00 AM | timed |
| Field trip: Science museum | next Mon | all-day | school-related |
| **Assignment due overlay** | Wed | — | Amber chip → school assignment |

3+ **all-day** events on one day (stress-test week header — post WHO-169 fix).

Categories/colors assigned per member. No Google sync required — `source: local` only.

### School (`/school`)

| Class | Student(s) | Content |
|-------|------------|---------|
| **Math 6** | Sofia | Assignment "Fractions worksheet" due Wed; one graded A |
| **Life Science** | Lucas | Lab report due Fri, not started |
| **History** | Sofia | Reading quiz completed |

Gradebook shows mixed completion; one submission with score for screenshot.

### Chores (`/chores`)

| Chore | Assignee | Status |
|-------|----------|--------|
| Load dishwasher | Lucas | done (karma +) |
| Vacuum living room | Sofia | due today |
| Take out recycling | James | overdue |
| Feed cat | Lucas | recurring, due today |

Karma balances visible; weekly report has data if opened.

### Shopping (`/shopping`)

List **Groceries** — items with aisles: Produce (bananas, spinach), Dairy (milk), Pantry (pasta), Bakery (bread). 2 checked off.

### Expenses (`/expenses`)

- Categories: Groceries, Activities, Utilities
- Month spend ~78% of grocery budget (meter visual)
- 5 recent transactions

### Notes (`/notes`)

- **Pinned:** "WiFi password: on router" (household)
- **Recent:** "Co-op supply list" (markdown, short)

### Drive (`/drive`)

- Folder `School/2026`
- Files: `field-trip-permission.pdf`, `co-op-schedule.png` (placeholder objects or tiny fixtures in `packages/db/fixtures/demo/`)
- One pinned file

### Health (`/health`)

- Sofia: daily vitamin (scheduled, shows calendar overlay)
- One PRN med with recent log

### Notifications / notices

- 2 notices; 1 unread for demo user (badge on megaphone)

---

## Screenshot shot list (WHO-134)

| Priority | Route | View | Why |
|----------|-------|------|-----|
| **P0** | `/calendar` | Week | Hero — modules + overlays + density |
| P1 | `/dashboard` | Default | Full product story |
| P1 | `/school` | Class or gradebook | Wedge differentiation |
| P2 | `/chores` | List + karma | Table stakes |
| P2 | `/drive` | Root folder | Differentiation |
| P3 | Mobile | Dashboard or calendar | PWA marketing |

Capture at **1280×800** and **390×844**; capture **light and dark** (`-{theme}.png`); landing uses `<picture>` to match `prefers-color-scheme`.

---

## Implementation phases

### Phase 1 — Seed script (local + CI) ✅

- [x] `packages/db/src/seed-demo.ts` + `dist/seed-demo.js`
- [x] `npm run db:seed-demo` in root `package.json`
- [x] Better Auth user + password for `demo@domi-ops.com`
- [x] Relative date helpers (`packages/db/src/seed-demo/dates.ts`)
- [x] Idempotent wipe by `households.slug = 'rivera-demo'`
- [x] Document in `docs/marketing/demo-household-spec.md` (this file) + SETUP dev section

### Phase 2 — Screenshot capture

- [x] Playwright script: `npm run marketing:capture-screenshots` → `docs/marketing/screenshots/` + `apps/web/public/marketing/screenshots/`
- [x] Light + dark variants; `ThemeAwareScreenshot` on `apps/www` landing
- [x] Wire landing into launch deploy (`apps/www` on `domi-ops.com` per ADR 002)

### Phase 3 — Public demo playground

- [ ] `demo.domi-ops.com` → app with `DEMO_MODE=true`
- [ ] Marketing footer link "Try demo"
- [ ] Banner: "Demo resets daily at 4:00 AM CT"
- [ ] Nightly reset cron documented in `deploy/`

### Phase 4 — Hardening (optional)

- [ ] Rate-limit demo login
- [ ] Block email export / webhooks on demo
- [ ] Disable VAPID on demo (no real push)

---

## Out of scope

- Google Calendar live sync on demo (local events only)
- Anonymized copy of real dogfood DB
- Per-visitor isolated sandboxes (single shared household is fine with nightly wipe)

---

## Open decisions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Subdomain `demo.domi-ops.com` vs path `/demo` | **Subdomain** — clean `PUBLIC_APP_URL`, same app image |
| 2 | Commit screenshot PNGs to repo? | **Yes** `docs/marketing/screenshots/` — marketing needs them without running seed |
| 3 | Demo password rotation | Static documented password OK with nightly wipe; rotate if abused |
