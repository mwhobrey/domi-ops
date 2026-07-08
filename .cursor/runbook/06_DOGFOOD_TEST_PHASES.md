# Dogfood test phases — operator checklist

**For:** Mike (and any agent resuming QA mid-session)  
**Context:** Post–`WHO-88` platform commit — Better Auth, username kids, single-pass import, school role views.  
**Companion docs:** [05_SCHOOL_QA.md](./05_SCHOOL_QA.md) (school detail matrix), [04_CURRENT_STATE.md](./04_CURRENT_STATE.md) (what ships), `docs/HOMEHUB_IMPORT.md` (cutover import).

Use this file to **track progress across sessions**. Check boxes as you go. When handing off to another agent, paste the **Session handoff** block at the bottom.

---

## Before you start

### Fresh dev reset (already done?)

```powershell
npm run dev:reset   # docker down -v, up postgres/redis/minio, flush redis, db:migrate
npm run dev         # web :3000, API :4000
```

- `GET http://localhost:4000/health` → DB connected
- `http://localhost:3000/login` loads
- `.env` has `SESSION_SECRET` (32+ chars), `ENCRYPTION_KEY`, `DATABASE_URL`
- `MODULES_ENABLED` includes `school` (default OK)

### Optional env (enable when testing that slice)


| Variable                                 | When needed                             |
| ---------------------------------------- | --------------------------------------- |
| `GOOGLE_OAUTH_CLIENT_ID` / `SECRET`      | Google login or calendar connect        |
| GCP redirect URI                         | `{PUBLIC_APP_URL}/auth/callback/google` |
| `S3_*` + MinIO                           | File upload, import artifacts           |
| HomeHub `config.yml`                       | Required for import — member roster + claim emails |
| `EMAIL_VERIFICATION_REQUIRED` + `SMTP_*` | Email verify flow (skip in default dev) |


---

## Phase 0 — Boot smoke

**Goal:** Stack is alive after reset.  
**Depends on:** nothing  
**Blocks:** everything else


| #   | Step                                               | Pass if                                                    |
| --- | -------------------------------------------------- | ---------------------------------------------------------- |
| 0.1 | `docker compose up -d postgres redis minio`        | Containers healthy                                         |
| 0.2 | `npm run dev` (or `build` + `dev` after code pull) | No boot errors                                             |
| 0.3 | Open `/login`                                      | Email / Username tabs; optional Google button if OAuth set |
| 0.4 | `GET /health` on API                               | `ok` + DB                                                  |


**Phase 0 status:** ☐ not started · ☐ in progress · x **pass** · ☐ blocked

**Notes:**

---

## Phase 1 — Auth on blank DB

**Goal:** Better Auth + first-household bootstrap on empty Postgres (no import).  
**Depends on:** Phase 0  
**Session:** Use **normal browser** (not incognito yet).


| #   | Step                                                             | Pass if                         |
| --- | ---------------------------------------------------------------- | ------------------------------- |
| 1.1 | `/login` → **Create owner account** (email + password, 8+ chars) | Redirects to `/dashboard`       |
| 1.2 | User menu in shell                                               | Shows email (not `@username`)   |
| 1.3 | `/profile`                                                       | Loads; name/presence editable   |
| 1.4 | Logout → sign in again (Email tab)                               | Session restores                |
| 1.5 | *(Optional)* Google sign-in                                      | OAuth completes; same household |


**Phase 1 status:** ☐ not started · ☐ in progress · x **pass** · ☐ blocked

**Owner email used:** me@mikewhob.com (email/password owner sign-up + Google sign-in verified)

**Notes:** Sign-up fixes [WHO-91]: Drizzle adapter schema/fields, auth client `basePath: "/auth"`. Bootstrap copies display name to member row. Removed nickname/public_label (`0017`). Sign-out uses `authClient.signOut()` (form POST → 415). GCP redirect: `{PUBLIC_APP_URL}/auth/callback/google`. Rebuild `@domi-ops/auth` + restart API after auth package changes.

---

## Phase 2 — Kid username + role matrix (WHO-47)

**Goal:** Parent provisions kid; student vs admin school views differ.  
**Depends on:** Phase 1 (owner logged in)  
**Sessions:** **Two browsers** — normal = parent, incognito = kid.

### Parent (owner) session


| #   | Step                                                            | Pass if                                               |
| --- | --------------------------------------------------------------- | ----------------------------------------------------- |
| 2.1 | `/profile` → **Household members**                              | Panel visible                                         |
| 2.2 | Provision kid: username, display name, password, role **child** | Listed as `@username`                                 |
| 2.3 | `/school`                                                       | Banner: **Managing household classes** (or Teaching…) |
| 2.4 | Create class (e.g. `Math 2026`)                                 | Appears on `/school`                                  |
| 2.5 | Class detail → **Enroll** kid as **student**                    | Roster shows kid                                      |


### Kid session (incognito)


| #    | Step                                     | Pass if                                           |
| ---- | ---------------------------------------- | ------------------------------------------------- |
| 2.6  | `/login` → **Username** tab → sign in    | Lands on dashboard/school                         |
| 2.7  | Shell                                    | Shows `@username` (no email)                      |
| 2.8  | `/school`                                | Banner: **Viewing as student**                    |
| 2.9  | `/school`                                | **No** create-class form                          |
| 2.10 | Open enrolled class                      | **No** Edit, **no** Roster, **no** New assignment |
| 2.11 | Parent creates assignment → kid opens it | Submit visible; **no** grade form                 |
| 2.12 | Parent grades → kid reloads assignment   | Kid sees grade; still no grade form               |


**Phase 2 status:** ☐ not started · ☐ in progress · x **pass** · ☐ blocked

**Kid username:** riley

**Notes:** Username sign-in required `authClient` browser `baseURL` fix (localhost vs 127.0.0.1). Assignment turn-in UX refactor + artifact upload; MinIO bucket ensured on dev-reset/API boot. Single-tenant join prevents duplicate owner on Google login.

---

## Phase 3 — School features (greenfield, WHO-42–46)

**Goal:** Class metadata, roster, categories, gradebook on data from Phase 2.  
**Depends on:** Phase 2  
**Session:** Parent/owner only.


| #   | Step                                       | Pass if                                                  |
| --- | ------------------------------------------ | -------------------------------------------------------- |
| 3.1 | Edit class: term, teacher, schedule        | Persists after reload                                    |
| 3.2 | Roster unenroll with confirm               | Member removed                                           |
| 3.3 | Add assignment **category** + weight       | Listed on class page                                     |
| 3.4 | New assignment via sheet + category picker | Saves with category                                      |
| 3.5 | `/school/class/[id]/gradebook`             | Matrix renders (assignments × students)                  |
| 3.5b | `/school/reports`                         | By-class and by-student rollups load                     |
| 3.6 | Grade on assignment page → open gradebook  | Grade visible **after manual refresh** (known SSR quirk) |
| 3.7 | *(Optional)* Upload on submission          | Works if MinIO/S3 configured                             |


**Phase 3 status:** ☐ not started · ☐ in progress · x **pass** · ☐ blocked

**Notes:**

---

## Phase 4 — HomeHub import (cutover path, WHO-90)

**Goal:** Single-pass import; school resolves Mom/Kid without login-first re-import.  
**Depends on:** Phase 0 (can run **parallel** to 1–3 on a **separate** reset DB, or after greenfield QA)  
**Data:** Real `data/app.db` + `uploads/` **or** fixture.

### 4A — Dry-run gate (no Postgres writes)

```powershell
npm run import:validate
npm run import:homehub -- --sqlite packages/import-homehub/fixtures/minimal-homehub.db --dry-run --strict
# Real DB:
# npm run import:homehub -- --sqlite .\data\app.db --uploads .\data\uploads --dry-run --strict
```


| #    | Step              | Pass if                                                       |
| ---- | ----------------- | ------------------------------------------------------------- |
| 4A.1 | Dry-run completes | `errors: []`                                                  |
| 4A.2 | Report            | `home_status_members` count > 0 when SQLite has `home_status` |


### 4B — Live import (single pass, **before** login)

```powershell
npm run import:homehub -- --sqlite .\data\app.db --uploads .\data\uploads
```


| #    | Step                                                                                                  | Pass if                                        |
| ---- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 4B.1 | Live import completes                                                                                 | No errors                                      |
| 4B.2 | **Before any login** — browse `/school` (auth may redirect; use SQL below or login as any user after) | Classes exist in DB                            |
| 4B.3 | SQL: `school_classes`, `school_enrollments`                                                           | Rows present; enrollments reference member IDs |
| 4B.4 | Re-run same import                                                                                    | Mostly `skipped`; no duplicate classes         |


**SQL spot-check** (psql or GUI):

```sql
SELECT name, legacy_display_name FROM household_members;
SELECT name, presence FROM home_status;
SELECT COUNT(*) FROM school_classes;
```

### 4C — Stub claim (optional, realistic cutover)

Place `config.yml` beside `app.db` (or pass `--config`). Import writes claim emails from `auth.display_names` / `allowed_emails`.

| #    | Step                           | Pass if                                         |
| ---- | ------------------------------ | ----------------------------------------------- |
| 4C.1 | Sign in as mapped Google/email | Joins imported household; stub claimed          |
| 4C.2 | Check members                  | No duplicate Mike/Ally/Riley rows               |
| 4C.3 | `/school` as parent vs kid     | Role matrix still holds on **imported** classes |

Username-only kids (`@riley`) still work when provisioned after import — email claim covers Riley if listed in HomeHub `allowed_emails`.


**Phase 4 status:** ☐ not started · ☐ skipped (no app.db yet) · ☐ in progress · x **pass** · ☐ blocked

**SQLite path used:** `.\data\app.db` + `.\data\config.yml` + `.\data\uploads`

**Notes:**

- Re-import after dogfood greenfield (not clean reset-first) — two-household edge case resolved via import-first household reconcile + orphan membership cleanup on claim.
- `config.yml` required: roster from `auth.display_names` / `allowed_emails`; `admin_emails` → owner/admin; `school.students` → child; Riley from config-only member + `home_status` row.
- Live import ~1m43s on real DB (3625 calendar rows); progress on stderr; `closeDb()` fixes CLI hang after JSON.

Detail: [05_SCHOOL_QA.md § Import verification](./05_SCHOOL_QA.md#import-verification-homehub--whome)

---

## Phase 5 — Regression spot-checks

**Goal:** Nothing else obviously on fire.  
**Depends on:** Phases 1–3 minimum; 4 if import done.


| #   | Area                         | Pass if                                                                                        |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| 5.1 | `/dashboard`                 | Glance + calendar month load                                                                   |
| 5.2 | `/calendar` → Connect Google | Starts OAuth (not dashboard bounce) — [WHO-84](https://linear.app/mikewhob-whome/issue/WHO-84) |
| 5.3 | Notice board on dashboard    | Post + read works                                                                              |
| 5.4 | Email verification           | Only if `EMAIL_VERIFICATION_REQUIRED=true` — sign-up shows verify message                      |


**Phase 5 status:** ☐ not started · ☐ in progress · x **pass** · ☐ skipped

**Notes:**

- **5.2 (WHO-84):** Connect Google bounced to login loop — `createAuthMiddleware` was registered after `googleCalendarAuthRoutes`; fixed in `apps/api/src/index.ts`. Retest: `/calendar` → Connect Google → Google OAuth consent.
- **5.4:** skipped (default dev — `EMAIL_VERIFICATION_REQUIRED` unset).

---

## Recommended order (fresh reset, first dogfood)

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 5
                              ↘
                    Phase 4 (when ready for app.db / cutover)
```

Phases **1–3** prove auth + school without import. Phase **4** proves cutover. Don't block school QA on import if `app.db` isn't copied yet.

---

## Session handoff (copy for next agent / chat)

```text
Dogfood QA — whome
Runbook: .cursor/runbook/06_DOGFOOD_TEST_PHASES.md
Last completed phase: 5 (pass) — phases 0–5 complete
Blocked on: —
Owner email: me@mikewhob.com
Kid username: riley
Import run: yes — .\data\app.db + .\data\config.yml + .\data\uploads
Failures / bugs: none open
Next step: staging cutover / prod import per deploy/CUTOVER.md
```

---

## Bug log (during QA)


| Date | Phase | Symptom | Severity | Linear / fix |
| ---- | ----- | ------- | -------- | ------------ |
| 2026-06-05 | 1 | Create owner account → generic error, API 500 empty body | blocker | [WHO-91](https://linear.app/mikewhob-whome/issue/WHO-91) — fixed `packages/auth/src/better-auth.ts` |
| 2026-06-05 | 1 | Profile name empty after owner sign-up | minor | `bootstrapHouseholdOnLogin` copies `users.display_name` → `household_members.name` |
| 2026-06-05 | 1 | Google login created second owner + shadow household | blocker | `single-tenant.ts` — join canonical household as `member`; repair on login |
| 2026-06-05 | 1 | Sign out → HTTP 415 | minor | HTML form POST; fixed `authClient.signOut()` in `AppChrome` |
| 2026-06-05 | 1 | `db:migrate` JSON parse error on journal | blocker | Restored missing `0016` entry + `0017` in `_journal.json` |
| 2026-06-05 | — | Removed `nickname` + `public_label` — single display name on Profile | cleanup | Migration `0017`; import ignores nickname |
| 2026-06-05 | 2 | Kid username sign-in → NetworkError | blocker | `auth-client.ts` — `window.location.origin`; `devLoopbackOrigins` in Better Auth |
| 2026-06-05 | 2 | School artifact upload → presign OK, PUT fails | blocker | Missing MinIO bucket after `dev:reset`; `ensureS3Bucket` + `scripts/ensure-minio.mjs` |
| 2026-06-05 | 2 | Assignment turn-in UX / artifact merge on save | enhancement | `SchoolAssignmentDetail.tsx`, `SchoolSubmissionArtifacts.tsx`, artifact file route |
| 2026-06-05 | 4 | Dogfood-then-import → two households / wrong HH for calendar+school | blocker | import-first reconcile in `household-membership.ts`; orphan cleanup on claim |
| 2026-06-05 | 4 | Riley missing from Who's Home after import | blocker | config-only stub + `ensureMemberHomeStatus` in import |
| 2026-06-05 | 4 | Re-import appeared hung after JSON | minor | `closeDb()` in `@domi-ops/db`; bulk `import_records` index |
| 2026-06-05 | 5 | Connect Google → login redirect loop | blocker | [WHO-84](https://linear.app/mikewhob-whome/issue/WHO-84) — auth middleware before calendar routes |


---

## Related Linear


| Issue                                                    | Topic                    |
| -------------------------------------------------------- | ------------------------ |
| [WHO-88](https://linear.app/mikewhob-whome/issue/WHO-88) | Better Auth + username   |
| [WHO-89](https://linear.app/mikewhob-whome/issue/WHO-89) | Email verification       |
| [WHO-90](https://linear.app/mikewhob-whome/issue/WHO-90) | Single-pass import stubs |
| [WHO-84](https://linear.app/mikewhob-whome/issue/WHO-84) | Calendar connect OAuth |
| [WHO-47](https://linear.app/mikewhob-whome/issue/WHO-47) | Role-aware school views  |
| [WHO-87](https://linear.app/mikewhob-whome/issue/WHO-87) | School QA runbook (05)   |


