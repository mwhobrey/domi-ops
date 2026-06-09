# whome — Linear backlog (draft)

**Live workspace:** see [`docs/LINEAR.md`](LINEAR.md) for projects, milestones, and issue links (WHO-5 … WHO-11).

Use this file for **full acceptance criteria** when creating or refining issues. Labels: one child per group — **Type** (`enhancement`, `chore`), **Area** (`web`, `api`, `db`, …), **Domain** (`household`, `profile`, `weather`, …).

**Current behavior (context only — not tickets):**

- Notice board: header pill → `Sheet`, per-user read state (`notice_reads`), post/list/mark read.
- Weather: Open-Meteo via API with US **NWS fallback** when Open-Meteo returns 502.
- Status: Home/Away toggles + **custom status field that currently overrides** preset when non-empty (see bug below).

---

## Epic: Profile & household identity

### Issue: Custom status is additive with Home/Away (not override)

**Type:** Bug / UX fix  
**Priority:** High  
**Labels:** `area:web`, `area:api`, `area:db`, `household`

**Problem**  
Today, filling “Custom status” replaces the stored `home_status.status` string. Home/Away toggles clear custom text. Household sees either `Home` / `Away` **or** a freeform string—not both.

**Desired behavior**  
Custom status is **in addition to** Home/Away:

- User always has a presence mode: **Home** or **Away** (for filters, “who’s home”, glance, etc.).
- Optional **status message** (e.g. “At work”, “Grocery run”, “Back by 5”) shown alongside the mode.
- Example display: **Away** · At work, or **Home** · Cooking dinner.
- Clearing the message does not change Home/Away; changing Home/Away does not delete the message (unless product explicitly wants “switching to Home clears message”—decide in design).

**Acceptance criteria**

- [ ] DB stores mode and message separately (e.g. `presence` enum or varchar + `status_message` varchar(64)), or encodes both in a structured way—avoid overloading a single `status` column.
- [ ] `PATCH /api/core/dashboard/home-status/:id` (or profile-scoped endpoint) accepts `{ presence: "Home"|"Away", message?: string }`.
- [ ] Dashboard household panel: Home/Away toggle + message field; message optional; both persist independently.
- [ ] “Who’s home” list shows mode + message where set (badge or secondary line).
- [ ] Migration from existing rows: `Home`/`Away` → presence; any other string → `Away` (or `Home`) + message = former string.
- [ ] Import/HomeHub mapping documented if legacy data has combined strings.

**Technical notes**

- Schema today: `home_status.status` varchar(64) — likely split to `presence` + `status_message` in `packages/db`.
- Files: `HouseholdPanel.tsx`, `apps/api/src/routes/core.ts` (`/dashboard`, `/profile`, home-status patch), `packages/db/src/schema/core.ts`.

---

### Issue: Weather units preference on profile (°F / °C)

**Type:** Feature  
**Priority:** Medium  
**Labels:** `area:web`, `area:api`, `profile`, `weather`

**Problem**  
Forecast temps are shown as bare `°` with Celsius from Open-Meteo and Celsius converted from NWS Fahrenheit in the API. Users cannot choose display units.

**Desired behavior**

- Profile setting: **Temperature unit** — `Fahrenheit` | `Celsius` (default: infer from locale or `F` for US deployments).
- Dashboard weather widget (and any future weather UI) respects the signed-in user’s preference.
- NWS fallback remains server-side; conversion happens in API or web consistently.

**Acceptance criteria**

- [ ] Persist preference per user (e.g. `users.temperature_unit` or `household_members` preference column).
- [ ] `GET/PATCH /api/core/profile` includes and updates `temperatureUnit`.
- [ ] Profile page control (radio or select) with save feedback.
- [ ] `WeatherPanel` displays values with correct unit suffix (`°F` / `°C`).
- [ ] Open-Meteo path: convert to preferred unit in API response or document that API returns both + client picks one field.
- [ ] NWS path: same end result as Open-Meteo for the user’s unit.

**Technical notes**

- `WeatherPanel.tsx`, `apps/api/src/routes/core.ts` (`/weather`), `ProfileEditor.tsx`, `packages/config` if env default needed.
- Optional: household-level default later (out of scope unless requested).

---

### Issue: Profile pictures (avatar upload)

**Type:** Feature  
**Priority:** Medium  
**Labels:** `area:web`, `area:api`, `area:db`, `storage`, `profile`

**Problem**  
Avatars are generated from initials/colors (`Avatar` component) using email/id. No user-uploaded photo.

**Desired behavior (MVP options — pick one in Linear)**

**Option A — Full MVP**

- Upload image on Profile (JPEG/PNG/WebP, size cap e.g. 2 MB).
- Store in S3/MinIO (`S3_*` env already exists); serve via signed URL or public bucket path per household.
- Show on profile, header account menu, household panel, and anywhere `Avatar` is used for that member.

**Option B — Phased (recommended note in issue)**

- **V1:** Profile UI section “Profile photo — coming soon” + optional **Gravatar** or **URL** field if cheap.
- **V2:** Upload + crop + S3 + delete/replace.

**Acceptance criteria (Option A)**

- [ ] `household_members.avatar_url` or `users.avatar_key` (or artifact table) with migration.
- [ ] `POST /api/core/profile/avatar` (multipart) + `DELETE` to remove.
- [ ] Image validation, resize/thumbnail (e.g. 256×256) — worker or sharp in API.
- [ ] Profile page upload control with preview; `Avatar` uses photo when present, falls back to initials.
- [ ] Other members can see avatars in household list (auth-scoped).

**Acceptance criteria (Option B — V1 note only)**

- [ ] Profile copy explains photos not yet supported; link to GitHub/Linear issue.
- [ ] No broken upload button.

**Technical notes**

- Reuse school upload patterns: `school-upload.ts`, presign if needed (`docs/ARCHITECTURE.md`).
- CSP / `next/image` domains for S3 public URL.
- Privacy: household-scoped keys only.

---

## Epic: Dashboard & weather reliability

### Issue: Richer “Today at a glance” cards (WHO-13)

**Type:** Enhancement  
**Priority:** Normal  
**Labels:** `web`, `api`, `household`

**Context**  
Dashboard `TodayGlance` tiles only show aggregate strings (“4 remaining”, “2 overdue”). Users must click into `/chores` or `/school` to see which items matter.

**Desired behavior**

- Keep headline metric + tone (overdue / due today / all clear).
- Add up to **3** preview lines per tile: chore description or assignment title + class, priority-ordered.
- “+N more” when overflow; lean glance APIs (no full list payloads).

**Acceptance criteria**

- [ ] Scanning dashboard answers “what’s due?” without navigation.
- [ ] List semantics + truncation; card height stays reasonable on mobile.

**Technical notes**

- `TodayGlance.tsx`, `StatTile.tsx` or `GlanceTile`; `GET /api/school/glance` + new chores glance endpoint.

---

### Issue: Hourly weather on dashboard day schedule sheet (WHO-12)

**Type:** Enhancement  
**Priority:** Normal  
**Labels:** `web`, `api`, `weather`

**Context**  
Tapping a day on the dashboard month calendar opens a Sheet listing that day’s events. Forecast context at each event’s time helps planning (e.g. outdoor chores, pickup windows).

**Desired behavior**

- Load hourly forecast for the saved weather location when the sheet opens.
- Timed events: weather icon + temp for the start hour (profile `temperatureUnit`).
- All-day events: day summary in header or no row weather (implementer’s choice).
- Missing location / failed forecast: events still list; no weather column.

**Acceptance criteria**

- [ ] Per-row icon + temp when hourly slot matches event `startTime`.
- [ ] `weather-codes` + `°F`/`°C`; non-blocking load.
- [ ] API may need hourly data for non-today dates (month picker).

**Technical notes**

- `DashboardMonthCalendar.tsx`, `WeatherPanel.tsx`, `/api/core/weather`, `weather-location.ts`.

---

### Issue: Open-Meteo outage handling & user-facing messaging

**Type:** Enhancement  
**Priority:** Low  
**Labels:** `area:api`, `weather`

**Context**  
Open-Meteo frequently returns 502 from some networks; NWS fallback covers US only.

**Acceptance criteria**

- [ ] Non-US locations get a clear error when both providers fail.
- [ ] Optional: cache last good forecast per lat/lon in Redis (TTL 30–60 min).
- [ ] Status endpoint or `source` field documented in runbook.

---

## Epic: Notice board & notifications

### Issue: Web Push / real notifications for notices

**Type:** Feature  
**Priority:** Low (was “would be great”)  
**Labels:** `area:web`, `pwa`, `notifications`

**Context**  
Notice board has unread counts and read state; no OS/browser push.

**Acceptance criteria**

- [x] Service worker subscription flow (permission UX).
- [x] Notify household members on new notice (exclude poster).
- [x] Tap notification opens notice board or relevant page.
- [x] Respect user opt-out in profile.

**Technical notes**

- `PwaRegister.tsx`, `public/sw.js` already exist — extend, don’t rewrite.

---

## Epic: DevEx & runbook (optional)

### Issue: Document migration journal workflow for Drizzle SQL files

**Type:** Chore  
**Priority:** Low  
**Labels:** `dx`, `db`

**Context**  
Manual SQL under `packages/db/drizzle/` must be registered in `drizzle/meta/_journal.json` or `npm run db:migrate` skips them.

**Acceptance criteria**

- [x] Runbook section in `03_RULES_AND_STANDARDS.md` or `04_CURRENT_STATE.md`.
- [x] Checklist: add SQL → journal entry → migrate → verify.

---

## Quick reference — file map

| Topic | Primary files |
|--------|----------------|
| Status presence + message | `HouseholdPanel.tsx`, `core.ts` routes, `schema/core.ts` |
| Weather units | `WeatherPanel.tsx`, `ProfileEditor.tsx`, `open-meteo.ts`, `nws-weather.ts` |
| Day sheet weather | `DashboardMonthCalendar.tsx`, `weather-codes.ts`, `core.ts` `/weather` |
| At-a-glance previews | `TodayGlance.tsx`, `StatTile.tsx`, `school.ts` `/glance`, chores glance API |
| Profile photo | `ProfileEditor.tsx`, `Avatar.tsx`, S3 upload routes, `schema` |
| Notices / push | `NoticeBoard.tsx`, `core.ts` notices routes, `sw.js` |
| Profile page | `apps/web/src/app/profile/page.tsx` |

---

## Linear issues (imported)

| ID | Title | Project |
|----|--------|---------|
| [WHO-6](https://linear.app/mikewhob-whome/issue/WHO-6) | Custom status additive with Home/Away | Profile & identity |
| [WHO-7](https://linear.app/mikewhob-whome/issue/WHO-7) | Weather units on profile | Profile & identity |
| [WHO-8](https://linear.app/mikewhob-whome/issue/WHO-8) | Profile pictures | Profile & identity |
| [WHO-5](https://linear.app/mikewhob-whome/issue/WHO-5) | Open-Meteo outage handling | Dashboard & weather |
| [WHO-12](https://linear.app/mikewhob-whome/issue/WHO-12) | Hourly weather on day schedule sheet | Dashboard & weather |
| [WHO-13](https://linear.app/mikewhob-whome/issue/WHO-13) | Richer Today at a glance cards | Dashboard & weather |
| [WHO-10](https://linear.app/mikewhob-whome/issue/WHO-10) | Web Push for notices | Notifications |
| [WHO-11](https://linear.app/mikewhob-whome/issue/WHO-11) | Notice board MVP (Done reference) | Notifications |
| [WHO-9](https://linear.app/mikewhob-whome/issue/WHO-9) | Drizzle migration journal | DevEx & platform |
| [WHO-14](https://linear.app/mikewhob-whome/issue/WHO-14) | Standardize local dev port (native :3000 default) | DevEx & platform |

---

## Epic: Dogfood cutover & OSS packaging (2026-06)

| ID | Title |
|----|--------|
| [WHO-133](https://linear.app/mikewhob-whome/issue/WHO-133) | Private GHCR publish workflow (pre-OSS) |
| [WHO-135](https://linear.app/mikewhob-whome/issue/WHO-135) | Login / sign-up UX — remove public owner registration |
| [WHO-134](https://linear.app/mikewhob-whome/issue/WHO-134) | Marketing landing page (post-dogfood / OSS) |

### Issue: Private GHCR publish workflow (pre-OSS) — WHO-133

**Type:** chore  
**Priority:** Normal  
**Labels:** `chore`, `dx`  
**Project:** DevEx & platform

**Goal**  
Stop on-droplet `docker compose up --build` (~45+ min, high RAM). Private repo stays private.

**Acceptance**

- [x] GitHub Actions builds `web`, `api`, `worker`, `import` images on push/tag
- [x] Push to private `ghcr.io/mwhobrey/whome-*` (no public repo required)
- [x] Droplet pulls via PAT `read:packages`; document in `deploy/CUTOVER-WHOBBREY.md`
- [x] Compose image refs + `WHO_IMAGE_TAG` for pull-only deploy
- [x] Document free-tier limits + `docker save`/`load` off-box fallback

---

### Issue: Login / sign-up UX — remove public owner registration — WHO-135

**Type:** enhancement  
**Priority:** High  
**Labels:** `enhancement`, `web`, `api`  
**Project:** Profile & identity (Better Auth)

**Problem**  
Login exposed “Create owner account” for any visitor. Hosted provisioning should create owners; self-host should use import + Google claim or a deliberate bootstrap path—not an open sign-up form.

**Shipped (dogfood)**

- [x] `ALLOW_PUBLIC_SIGNUP` env (default off in production); API blocks `/auth/sign-up/*`
- [x] Login UI hides owner sign-up when disabled (no DB read on login page)
- [x] `/` redirects to `/login` for unauthenticated users
- [x] Login visual polish (brand lockup, 44px targets, join callout when signup disabled)

**Follow-up** (separate issues / post-dogfood)

- [ ] Self-host greenfield bootstrap without public sign-up (CLI or one-time setup token)
- [ ] Hosted owner provisioning flow design

---

### Issue: Marketing landing page (post-dogfood / OSS) — WHO-134

**Type:** enhancement  
**Priority:** Low  
**Labels:** `enhancement`, `web`  
**Project:** DevEx & platform (or new `Marketing` project)

**Problem**  
`/` redirects to `/login` for dogfood. Public OSS release needs a real landing (features, self-host CTA, GitHub link, privacy).

**Acceptance**

- [ ] Restore or replace `apps/web/src/app/page.tsx` marketing content
- [ ] Authenticated users still route to `/dashboard`
- [ ] Unauthenticated `/` shows marketing; app entry at `/login`
- [ ] Optional: separate `apps/www` or static site on `whome.com` subdomain

---

*Refine priorities and avatar Option A vs B on WHO-8 before implementation.*
