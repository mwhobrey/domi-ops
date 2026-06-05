# School module — manual QA runbook

Operator checklist for Mike. Pair with `docs/SCHOOL_PARITY.md` (field matrix) and Linear School project [WHO-41](https://linear.app/mikewhob-whome/issue/WHO-41)–[WHO-48](https://linear.app/mikewhob-whome/issue/WHO-48).

## Prerequisites

### Environment

- [ ] Node `>=20`, repo root `.env` from `.env.example` (full `.env` for live import / dev server; **dry-run import gate below needs no Postgres**)
- [ ] `MODULES_ENABLED` includes `school` (default: `core,school,calendar_sync`)
- [ ] `SESSION_SECRET` (32+ chars), `ENCRYPTION_KEY` set for non-trivial auth tests

### Docker services

```bash
docker compose up -d postgres redis minio
npm install && npm run build && npm run db:migrate
npm run dev   # web http://localhost:3000, API http://localhost:4000/health
```

- [ ] `GET http://localhost:4000/health` → DB connected
- [ ] S3/MinIO env present if testing submission file upload or import artifacts: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true`

### Test household

| Path | Notes |
|------|-------|
| **Fresh DB** | `npm run dev:reset` then migrate — empty school, good for create-flow QA |
| **Fixture import** | `npm run fixture:homehub` then live import (see Import verification) |
| **Real HomeHub** | Copy `app.db` + `uploads/` per `docs/HOMEHUB_IMPORT.md` |

### Roles (WHO-47 — role-aware views)

School UX is **role-aware** via session `memberId` + household role + per-class `school_enrollments.role`.

| View mode | How it resolves | Landing label |
|-----------|-----------------|---------------|
| **admin** | Household role `owner` or `admin` | "Managing household classes" |
| **staff** | Enrolled `teacher`/`parent`/`aide`, or `teacher_member_id` on a class | "Teaching & managing classes" |
| **student** | Enrolled `student` only (no staff roles) | "Viewing as student" |
| **observer** | Enrolled `observer` only | "Observer — read only" |

**Test accounts:** Each login maps to one `users` row + `household_members` row.

1. **Parent/teacher:** Email sign-up (owner) or Google sign-in → auto-join imported household.
2. **Student (preferred):** Owner provisions username member on **Profile → Household members** (`POST /api/core/household/members/provision`). Student signs in at `/login` → **Username** tab. No email or Google required.

Setup checklist:

- [ ] Owner: email sign-up or Google sign-in → auto-join imported household (`join-imported.ts`)
- [ ] **Profile → Household members:** provision student username (role `child`), set password, note `@username`
- [ ] Student: `/login` → Username → sign in; confirm `/school` shows "Viewing as student"
- [ ] **Profile** (`/profile`): set nickname/label for each member name used in HomeHub (`teacher_id`, `student_id` in SQLite map to `legacy_display_name` / nickname)
- [ ] For roster tests: at least two members (e.g. parent owner + student child from `home_status`)
- [ ] Enroll student member on ≥1 class with role **student**; parent as **teacher** or **parent** on same or other class

### Import dry-run gate (before live import)

No Docker/Postgres required — reads the SQLite fixture only.

```bash
npm run import:validate
npm run import:homehub -- --sqlite packages/import-homehub/fixtures/minimal-homehub.db --dry-run --strict
```

- [ ] `errors: []`; review `warnings` (unmapped teachers/students are expected until profile nicknames match)

---

## Smoke test — routes

### `/school` (landing)

File: `apps/web/src/app/school/page.tsx`, `SchoolClassList.tsx`

- [ ] **View banner:** role label badge ("Managing household classes" / "Viewing as student" / etc.)
- [ ] StatTiles: Classes count, Due this week, Overdue (from `GET /api/school/glance`, scoped to visible classes)
- [ ] Class cards: name, subject, term badge, enrollment role badge when applicable (`SchoolClassCard`)
- [ ] **Admin/staff:** Create class form visible; create works
- [ ] **Student:** Create class form **absent**; only enrolled classes listed; section titled "My classes"
- [ ] Empty state when no classes (wording differs for student vs admin)
- [ ] **Archived classes:** excluded from default list (admin: `?includeArchived=true` on API if needed later)

### `/school/class/[id]` (class detail)

Files: `apps/web/src/app/school/class/[id]/page.tsx`, `SchoolClassDetail.tsx`

- [ ] Breadcrumb: School → class name
- [ ] Metadata: term, teacher (member label), schedule summary, archived badge when set
- [ ] **Admin/staff:** Edit class details; Progress shows all students + link to full gradebook
- [ ] **Student:** No Edit button; Progress shows **own** missing/overdue/graded only; no full gradebook link
- [ ] **Student:** Assignments list visible (no draft); no New assignment / edit pencil
- [ ] **Student:** Roster section **hidden**
- [ ] **Observer:** Read-only — no edit/enroll; can view assignments and full gradebook matrix
- [ ] **Admin/staff:** Assignments create/edit Sheet includes optional **category** picker when categories exist
- [ ] **Admin/staff:** Categories add/list/remove; Roster enroll/unenroll with `ConfirmDialog`

### `/school/class/[id]/gradebook`

Files: `apps/web/src/app/school/class/[id]/gradebook/page.tsx`, `SchoolClassGradebook.tsx`

- [ ] Matrix: students × assignments; sticky student column
- [ ] Cell states: missing, overdue, submitted, graded, not_assigned (draft)
- [ ] Summary stats: assignment count, missing, overdue, class average
- [ ] ARIA: table `caption`, readable headers
- [ ] **Regression:** gradebook is server-rendered on navigation — grading on assignment page does not auto-refresh this page until reload/navigate away and back

### `/school/assignment/[id]`

Files: `apps/web/src/app/school/assignment/[id]/page.tsx`, `SchoolAssignmentDetail.tsx`

- [ ] Breadcrumb: School → class → assignment
- [ ] Instructions HTML, due, points, visibility badge
- [ ] **Student:** Submit + upload visible; grade form **hidden**; "Your grade" card when graded
- [ ] **Teacher:** Grade form visible; can grade any student submission
- [ ] Status badges: not_started, submitted, graded, returned
- [ ] Imported artifacts: `s3Key` presign download when S3 object exists

---

## Feature matrix — Linear WHO-41–48

| Issue | Title | Verify | Expected |
|-------|-------|--------|----------|
| [WHO-41](https://linear.app/mikewhob-whome/issue/WHO-41) | Parity matrix doc | `docs/SCHOOL_PARITY.md` exists, matches schema | Table ↔ import ↔ UI columns accurate |
| [WHO-42](https://linear.app/mikewhob-whome/issue/WHO-42) | Class metadata UI | Edit class on detail page | term, teacher, schedule persist after save |
| [WHO-43](https://linear.app/mikewhob-whome/issue/WHO-43) | Enrollment UX | Enroll + unenroll | Roster shows avatar, role, dates, confirm on remove |
| [WHO-44](https://linear.app/mikewhob-whome/issue/WHO-44) | Gradebook / progress | Progress section + `/gradebook` | Missing/overdue/graded counts sane |
| [WHO-45](https://linear.app/mikewhob-whome/issue/WHO-45) | Categories + weights | Category CRUD on class page | Weights display; imported categories listed |
| [WHO-46](https://linear.app/mikewhob-whome/issue/WHO-46) | Submission workflow | Assignment detail | Steps clear; upload + grade round-trip |
| [WHO-47](https://linear.app/mikewhob-whome/issue/WHO-47) | Student/parent home | Role-based test matrix (below) | Landing + class/assignment views differ by enrollment |
| [WHO-48](https://linear.app/mikewhob-whome/issue/WHO-48) | UX makeover epic | Design system on school pages | StatTiles, sheets, empty states, focus rings |

---

## Role-based test matrix (WHO-47)

Run each row with the appropriate Google account / household member.

| Step | Parent / teacher (admin or staff) | Student (student enrollment only) | Observer |
|------|-----------------------------------|-----------------------------------|----------|
| `/school` banner | "Managing…" or "Teaching…" | "Viewing as student" | "Observer — read only" |
| Class list | All household classes (non-archived) or staff-taught | Only enrolled classes | Enrolled classes only |
| Create class | Form present, works | Form **absent** | Form **absent** |
| Class detail — Edit | Visible | **Hidden** | **Hidden** |
| Class detail — Roster | Full roster + enroll | **Section absent** | View roster (read-only) |
| Class detail — New assignment | Visible | **Hidden** | **Hidden** |
| Assignment detail — Submit | N/A or parent testing | Works for self | **Hidden** |
| Assignment detail — Grade | Visible | **Hidden** | **Hidden** |
| `/gradebook` | Full matrix | Blocked (own progress on class page) | Full matrix read-only |
| API `POST /classes` as student | — | `403 forbidden` | — |

## Regression watchlist

| Gap | Where to check | Expected today |
|-----|----------------|----------------|
| Archived class filtering | `/school` list + glance `classCount` | Archived classes **excluded** by default |
| Gradebook live refresh | Grade on assignment → return to gradebook | Manual refresh required (SSR snapshot) |
| Attendance UI | Any route | Data imports to `school_attendance`; **no UI** |
| Per-member login switcher | Single browser session | One Google user = one member; no in-app switch |
| `graded_by` on import | DB only | HomeHub `graded_by` not mapped to `graded_by_user_id` |

---

## Accessibility

- [ ] Tab through `/school` class cards — visible focus ring
- [ ] Class detail: Edit, Add assignment, Enroll, roster Remove buttons reachable by keyboard
- [ ] Unenroll opens `ConfirmDialog` — Esc closes, focus trapped, primary action labeled "Remove"
- [ ] Gradebook table: screen reader caption + column headers
- [ ] Sheets/modals: focus moves into dialog; close returns focus (native `<dialog>`)

---

## API spot-checks

Use browser DevTools → Network (Better Auth session cookie) or curl with cookie jar after login.

Base: `http://localhost:4000/api/school` (native dev) or proxied via web `/api/school`.

```bash
# School context (role view mode)
curl -s -b cookies.txt http://localhost:4000/api/school/context | jq .

# Glance (dashboard + school tiles; includes context)
curl -s -b cookies.txt http://localhost:4000/api/school/glance | jq .

# Classes list (scoped + context)
curl -s -b cookies.txt http://localhost:4000/api/school/classes | jq '{count: (.classes | length), viewMode: .context.viewMode}'

# Gradebook
curl -s -b cookies.txt http://localhost:4000/api/school/classes/CLASS_UUID/gradebook | jq '.summary'

# Enroll
curl -s -b cookies.txt -X POST http://localhost:4000/api/school/classes/CLASS_UUID/enrollments \
  -H 'Content-Type: application/json' \
  -d '{"memberId":"MEMBER_UUID","role":"student"}' | jq .

# Categories
curl -s -b cookies.txt http://localhost:4000/api/school/classes/CLASS_UUID/categories | jq .
curl -s -b cookies.txt -X POST http://localhost:4000/api/school/classes/CLASS_UUID/categories \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tests","weightPercent":40}' | jq .
```

- [ ] `403 school_disabled` when `school` module removed from `MODULES_ENABLED`
- [ ] Cross-household class UUID → `404 not_found`

---

## Import verification (HomeHub → whome)

### Pipeline

| Step | Location |
|------|----------|
| CLI | `npm run import:homehub` → `packages/import-homehub/src/cli.ts` |
| Orchestration | `packages/import-homehub/src/importer.ts` — **home_status stubs** then domain mappers; **files before school** (S3 keys for artifacts) |
| Stub members | `packages/import-homehub/src/mappers/home-status-members.ts` — `legacy_display_name` for single-pass school resolution |
| School mapper | `packages/import-homehub/src/mappers/school.ts` |
| File → S3 | `packages/import-homehub/src/mappers/files.ts` |
| Member resolution | `packages/import-homehub/src/lib/member-resolve.ts` (`legacy_display_name` from `home_status.name`) |
| Idempotency | `import_records` table; re-import hydrates `ctx.idMap` from prior rows |

### Commands

```bash
npm run fixture:homehub   # regenerate minimal-homehub.db
npm run import:validate

# Dry-run
npm run import:homehub -- \
  --sqlite packages/import-homehub/fixtures/minimal-homehub.db \
  --uploads ./fixtures/homehub/uploads \
  --dry-run --strict

# Live (wipes nothing; idempotent)
npm run import:homehub -- \
  --sqlite packages/import-homehub/fixtures/minimal-homehub.db \
  --uploads ./fixtures/homehub/uploads
```

### Post-import — UI checks

- [ ] `/school` shows imported class **Math** (fixture)
- [ ] Class detail: term `2026`, teacher label matches `Mom` member, roster shows `Kid` as student
- [ ] Assignment **Chapter 1** visible; submission row for student
- [ ] Re-run import → report `school_skipped` increases; no duplicate classes

### Post-import — SQL checks

Replace `HOUSEHOLD_ID` with id from `households` after import.

```sql
-- Row counts vs SQLite
SELECT source_table, COUNT(*) FROM import_records
WHERE household_id = 'HOUSEHOLD_ID' AND source_table LIKE 'school_%'
GROUP BY source_table ORDER BY source_table;

-- Classes
SELECT id, name, term, archived, schedule_json FROM school_classes
WHERE household_id = 'HOUSEHOLD_ID';

-- Enrollments with member labels
SELECT sc.name, se.role, hm.legacy_display_name, hm.nickname
FROM school_enrollments se
JOIN school_classes sc ON sc.id = se.class_id
JOIN household_members hm ON hm.id = se.member_id
WHERE sc.household_id = 'HOUSEHOLD_ID';

-- Assignments with category linkage
SELECT a.title, a.category_id, c.name AS category_name
FROM school_assignments a
JOIN school_classes sc ON sc.id = a.class_id
LEFT JOIN school_assignment_categories c ON c.id = a.category_id
WHERE sc.household_id = 'HOUSEHOLD_ID';

-- Orphan check (should return 0 rows)
SELECT a.id, a.title FROM school_assignments a
LEFT JOIN school_classes sc ON sc.id = a.class_id
WHERE sc.id IS NULL;

-- Submissions without student mapping (should be 0 after successful import)
SELECT COUNT(*) FROM school_submissions ss
LEFT JOIN school_assignments a ON a.id = ss.assignment_id
LEFT JOIN school_classes sc ON sc.id = a.class_id
WHERE sc.household_id = 'HOUSEHOLD_ID' AND ss.student_member_id IS NULL;

-- Artifacts with S3 keys
SELECT sa.id, sa.artifact_type, sa.s3_key IS NOT NULL AS has_s3
FROM school_submission_artifacts sa
JOIN school_submissions ss ON ss.id = sa.submission_id
JOIN school_assignments a ON a.id = ss.assignment_id
JOIN school_classes sc ON sc.id = a.class_id
WHERE sc.household_id = 'HOUSEHOLD_ID';

-- Attendance (import only; no UI)
SELECT COUNT(*) FROM school_attendance sa
JOIN school_classes sc ON sc.id = sa.class_id
WHERE sc.household_id = 'HOUSEHOLD_ID';
```

### Import warning triage

| Warning pattern | Action |
|-----------------|--------|
| `teacher "X" not mapped` | Set Profile nickname/label = `X` for correct member, or accept fallback owner |
| `student "Y" not mapped` | Profile label must match HomeHub `student_id` string |
| `unknown class_id` on re-import | Fixed: idMap hydration from `import_records` (Jun 2026) |
| `file N: missing on disk` | Copy `uploads/` from droplet; artifact `s3_key` will be null |
| `S3 upload failed` | Check MinIO up + env |

---

## Bug report template

```markdown
### Summary
One line.

### Environment
- URL: http://localhost:3000 or staging
- Browser + version:
- DB: fresh / fixture import / droplet import
- `MODULES_ENABLED`:

### Steps
1.
2.
3.

### Expected
-

### Actual
-

### Evidence
- Screenshot:
- Network: method + path + status + response snippet
- API response body (redact ids if posting publicly)

### Linear
- New issue in [School](https://linear.app/mikewhob-whome/project/school-28fede3d2344) project, label `bug` if applicable
```

---

## Quick validation order (Mike — start here)

1. `docker compose up -d postgres redis minio && npm run build && npm run db:migrate`
2. `npm run import:validate` — must pass
3. `npm run dev` → Google login → `/school`
4. Run **Smoke test — `/school`** section above
5. If testing migration path: live fixture import → **Post-import — UI checks**
6. File issues in Linear with template above
