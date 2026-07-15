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
| `school_attendance` | `school_attendance` | ✅ | ❌ No attendance UI |
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
| Assignment materials | ✅ `school_assignment_materials` | ✅ Sheet materials editor + detail Materials card (WHO-201–204) |
| Google attach (`google_doc`) | ✅ Picker session + Drive `files.get` verify | ✅ **Add from Google** (`GooglePickerButton`, WHO-206–207) |
| Student Google test copy + submit | ✅ `start-copy`, `google-artifacts`, lineage (WHO-209–212) | ✅ Connect banner, **Start test** / **Open your copy**, Picker submit, teacher lineage badges |
| Native in-app test (teacher builder) | ✅ `native_test` + full-page editor (WHO-214, WHO-218) | ✅ **Create in-app test** → `/materials/:id/edit`, preview, points modes; export UI shell (WHO-217 API pending) |
| Native in-app test (student take) | ✅ WHO-215 | ✅ **Take test** CTA + take page + draft save; soft-warn partial turn-in |
| Native in-app test (auto-grade + review) | ✅ WHO-216 / WHO-220 | ✅ Auto-score on submit (scales to assignment points); teacher student selector + per-question review/override + grade in Student work |
| Convert Google Doc → native test | ⏳ WHO-219 | Backlog — non-destructive import + review wizard |
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
