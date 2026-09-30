# School LMS parity (HomeHub → Domi Ops)

## HomeHub SQLite → Domi Ops Postgres

| HomeHub table | Domi Ops table | Import | UI (Domi Ops) |
|---------------|-------------|--------|------------|
| `school_class` | `school_classes` | ✅ `importSchool` | `/school` cards; detail metadata (term, teacher, schedule) |
| `school_enrollment` | `school_enrollments` | ✅ | Class roster — role badges, active dates, enroll/unenroll |
| `school_assignment_category` | `school_assignment_categories` | ✅ | ✅ per-class list + weights on class detail |
| `school_assignment` | `school_assignments` | ✅ | Class list + `/school/assignment/[id]` |
| `school_submission` | `school_submissions` | ✅ | Submit + status on assignment page |
| `school_grade_entry` | `school_grades` | ✅ | Grade form on assignment page |
| `school_attendance` | `school_attendance` | ✅ | ✅ Class page **Attendance** card (WHO-347); per-student summary on `/school/records` |
| `school_submission_artifact` | `school_submission_artifacts` | ✅ + S3 | Presign upload on assignment page |

## Field-level: `school_class`

| HomeHub column | Domi Ops column | Create UI | Edit UI | Notes |
|----------------|--------------|-----------|---------|-------|
| `name` | `name` | ✅ | ✅ PATCH | |
| `subject` | `subject` | ✅ | ✅ PATCH | |
| `term` | `term` | ✅ | ✅ PATCH | |
| `teacher_id` | `teacher_member_id` | auto (creator) | ✅ select | Import resolves legacy member id |
| `schedule_json` | `schedule_json` | ❌ | ✅ summary text | Stored as `{ "summary": "…" }` |
| `archived` | `archived` | ❌ | ✅ PATCH checkbox | Edit class details |

## Field-level: `school_enrollment`

| HomeHub column | Domi Ops column | Enroll UI | Roster UI | Notes |
|----------------|--------------|-----------|-----------|-------|
| `student_id` | `member_id` | ✅ select | ✅ avatar + label | |
| `role` | `role` | ✅ picker | ✅ badge | student, teacher, parent, aide, observer |
| `active_from` | `active_from` | ✅ optional date | ✅ formatted | |
| `active_to` | `active_to` | ✅ optional date | ✅ + inactive badge | |

## Field-level: assignments & grading

| Capability | API | UI |
|------------|-----|-----|
| CRUD assignments | ✅ | ✅ Sheet: title, due, points, instructions, visibility, max attempts |
| Assignment materials | ✅ `school_assignment_materials` | ✅ Sheet materials editor + detail Materials card; new assignments background-save for continuous material actions (WHO-201–204, WHO-221) |
| Google attach (`google_doc`) | ✅ Picker session + Drive `files.get` verify | ✅ **Add from Google** (`GooglePickerButton`, WHO-206–207) |
| Student Google test copy + submit | ✅ `start-copy`, `google-artifacts`, lineage (WHO-209–212) | ✅ Connect banner, **Start test** / **Open your copy**, Picker submit, teacher lineage badges |
| Native in-app test (teacher builder) | ✅ `native_test` + full-page editor (WHO-214, WHO-218) | ✅ **Create in-app test** → `/materials/:id/edit`, preview, points modes; **Export to Google Doc** (WHO-217) |
| Native in-app test (student take) | ✅ WHO-215 | ✅ **Take test** CTA + take page + draft save; soft-warn partial turn-in |
| Native in-app test (auto-grade + review) | ✅ WHO-216 / WHO-220 | ✅ Auto-score on submit (scales to assignment points); teacher student selector + per-question review/override + grade in Student work |
| Convert Google Doc → native test | ✅ WHO-219 / WHO-221 | ✅ **Import Google test** Picker → preview → new `native_test`; keeps original, no save/close/reopen |
| Materials freeze (`is_test`) | ✅ First submission → S3 snapshot (Drive/URL/Google) | ✅ Frozen badge; snapshot proxy; Google fail-loud (WHO-208) |
| Strict content check (Google tests) | ✅ `strict_content_check` on material + L2 diff | ✅ Teacher checkbox on `is_test` + `google_doc` materials |
| Categories + weights | ✅ | ✅ Add/list/remove on class detail |
| Submissions | ✅ | ✅ Workflow steps + file upload |
| Grading + feedback | ✅ | ✅ Score + feedback + status badges |
| Gradebook / progress | ✅ `GET …/gradebook` | ✅ Progress section + `/gradebook` matrix |
| Visibility (draft/assigned/closed) | ✅ | ✅ Badge + edit sheet |
| Role-aware views (student vs parent) | ✅ `GET /context`, scoped list/glance, `access` on detail | ✅ WHO-47 — banner, conditional UI |

## Dashboard integration

| Feature | Status |
|---------|--------|
| `GET /api/school/glance` | ✅ due/overdue preview |
| School stat tiles on `/school` | ✅ class count + glance stats |
| Today at a glance tile | ✅ `TodayGlance` |

## QA checklist

- [ ] Imported class shows term, teacher label, schedule summary on detail page
- [ ] Create class with name, subject, term → card reflects metadata
- [ ] Enroll household member with role → roster shows avatar, role badge, dates
- [ ] Unenroll with confirmation → member removed from roster
- [ ] Active date range shows on roster; past `active_to` shows Inactive badge
- [ ] Assignment with due date shows formatted due + visibility badge
- [ ] Empty states: no classes, no assignments, no enrollments
- [ ] Keyboard: class cards focus ring; roster/enrollment form reachable
- [ ] Gradebook / categories (WHO-44, WHO-45) — shipped this session
- [ ] Attendance marking — not started
- [ ] Student/parent home (WHO-47) — role-aware landing + class/assignment views

## Homeschool records (WHO-347)

Not from HomeHub. Added for states that require attendance, hours, or a transcript.

| Capability | API (`routes/school-records.ts`) | UI |
|------------|-----------------------------------|----|
| Attendance per class per day | `GET/PUT /classes/:id/attendance` (PUT bulk-upserts one date; `status: null` clears) | Class page **Attendance** card |
| Instruction hours | `GET /records/:studentId`, `POST/PATCH/DELETE /hours` (`school_hours_log`, minutes 1-1440) | `/school/records` hours log |
| Days attended / absent / excused | `GET /records/:studentId?from&to` | `/school/records` stat tiles |
| Transcript | `GET /transcript/:studentId?from&to` | `/school/transcript/:id`, printable |

**Rules worth knowing**
- A school day counts as **attended** if any class marked the student present or late. **Absent** only if every entry that day was absent. Days with only excused (or excused plus absent) marks count as **excused**, never against the student. (`lib/school-records.ts`)
- **Transcript grade** per course is the weighted category average when the class has weighted categories, else the points average. Scale: A 90+, B 80+, C 70+, D 60+, F below; GPA is unweighted 4.0, credit-weighted. A course with nothing graded is "in progress": no letter, no credit, no GPA effect. F attempts credits but earns none. (`lib/school-transcript-math.ts`)
- Transcripts include **archived classes and ended enrollments**, since past school years are exactly what they exist for. `buildClassGradebook(..., { includeInactive: true })`.
- `school_classes.credits` (default 1 = full-year course) is edited on the class details card. Terms group by the class **Term** text, so use a consistent label such as `2025-2026`.
- **Access:** household owner/admin and class teacher/parent/aide enrollments can write. Staff see only students in classes they manage. A student reads only their own; observers see nothing. Other households get 404.
- Test: `apps/api/src/routes/school-records.integration.test.ts` (needs Postgres with migration 0080; skipped without one).
