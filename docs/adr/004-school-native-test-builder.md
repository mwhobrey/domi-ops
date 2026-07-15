# ADR 004: School native in-app test builder

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-07-10 |
| **Signed off** | Mike — 2026-07-10 |
| **Linear** | [WHO-213](https://linear.app/mikewhob-whome/issue/WHO-213) · Epic [WHO-200](https://linear.app/mikewhob-whome/issue/WHO-200) Phase 4 |
| **Related** | [WHO-214](https://linear.app/mikewhob-whome/issue/WHO-214)–[WHO-217](https://linear.app/mikewhob-whome/issue/WHO-217), [ADR 003](./003-hosted-db-architecture.md), `docs/HOSTED_RLS.md` |

## Context

Phases 1–3 of epic WHO-200 shipped assignment materials with Google Doc tests: teacher attach via Picker, freeze on first household submission, student `files.copy` + Picker submit, and lineage checks — all under existing `documents` + `drive.file` OAuth scopes.

Homeschool teachers still need **structured quizzes** (multiple choice, true/false, short answer) that:

- Work on mobile without opening Google Docs
- Auto-grade objective questions
- Roll scores into the existing gradebook (`school_grades`, gradebook matrix)
- Coexist on the same assignment as Google Doc or Drive materials

Phase 4 adds a **native in-app test builder** as an alternative material source, not a replacement for Google Doc tests.

**Constraints (locked from epic WHO-200):**

- Materials remain anchored on `school_assignment_materials` (not a parallel assignment type)
- `is_test` materials freeze on first household submission
- `max_attempts` on assignment; `turn_in_count` on `school_submissions`
- Answer keys never leak to student API payloads
- Long-form / essay answers: **manual grade only** — no AI
- No expansion to full Google `drive` scope; one-way export to Google Doc uses existing Docs API (WHO-217)
- Hosted Starter RLS must cover new tables ([ADR 003](./003-hosted-db-architecture.md))

## Decision

### 1. Material source: `native_test`

Add `native_test` to enum `school_material_source`.

A native test is one `school_assignment_materials` row:

- `source = 'native_test'`
- `is_test = true` (typical; required for freeze + student take flow)
- `role = 'student_material'` (default visibility; teacher may adjust toggles)
- Questions stored in `school_test_questions` keyed by `material_id`

Google Doc tests (`source = 'google_doc'`) and native tests may appear on the **same assignment** as separate material rows.

### 2. Question types (v1)

| Type | `question_type` | Auto-grade | Notes |
|------|-----------------|------------|-------|
| Multiple choice (single) | `multiple_choice` | Yes | One correct option id |
| Multiple choice (multi) | `multiple_choice_multi` | Yes | Set of correct option ids; all-or-nothing v1 |
| True / false | `true_false` | Yes | `correct_answer_json: { "value": true \| false }` |
| Short answer | `short_answer` | Yes | Normalized exact match (trim, case-insensitive) |
| Long answer | `long_answer` | No | Teacher scores manually |

**Non-goals v1:** file upload, matching, numeric with tolerance, essay AI grading, question banks, randomized order, timed lockdown.

### 3. Schema

#### `school_test_questions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `material_id` | uuid FK → `school_assignment_materials` ON DELETE CASCADE | |
| `sort_order` | integer | Reorderable; unique per material via index |
| `question_type` | enum `school_question_type` | See table above |
| `prompt_markdown` | text | Markdown prompt; see §3a |
| `points` | real nullable | Explicit mode: points per question |
| `weight` | real nullable | Weighted mode: relative weight (default 1) |
| `options_json` | jsonb nullable | MC: `[{ "id": "a", "label": "…" }, …]` |
| `correct_answer_json` | jsonb | Staff-only in API; shape varies by type |
| `created_at` / `updated_at` | timestamptz | |

Index: `(material_id, sort_order)`.

#### `school_submission_responses`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `submission_id` | uuid FK → `school_submissions` | |
| `material_id` | uuid FK → `school_assignment_materials` | Denormalized for queries |
| `question_id` | uuid FK → `school_test_questions` | |
| `turn_in_number` | integer | Matches `submission.turn_in_count + 1` while drafting; locked turn on submit |
| `response_json` | jsonb | Type-specific student answer |
| `auto_score` | real nullable | Set on submit for auto-grade types |
| `manual_score` | real nullable | Teacher override / long-answer score |
| `graded_by_user_id` | uuid nullable | |
| `graded_at` | timestamptz nullable | |
| `created_at` / `updated_at` | timestamptz | |

Unique: `(submission_id, question_id, turn_in_number)`.

#### Extend `school_assignment_materials`

| Column | Type | Notes |
|--------|------|-------|
| `snapshot_json_s3_key` | text nullable | Frozen question snapshot (questions + answer keys for audit) |
| `native_test_points_mode` | enum `explicit` \| `weighted` | Default `explicit`; only when `source = native_test` |

#### 3a. Prompt content: Markdown + embeds (not HTML)

**Decision:** Store `prompt_markdown`, not HTML. Render with existing [`MarkdownContent`](../../apps/web/src/components/ui/MarkdownContent.tsx) (`react-markdown` + GFM).

**Why not HTML:** Smaller XSS surface, matches Notes/Drive embed patterns already in the repo, easier export to Google Doc (WHO-217), and sufficient for homeschool prompts.

**Embeds v1:**

| Syntax | Purpose |
|--------|---------|
| `[[drive:uuid\|label]]` | Domi Ops Drive file — images inline when image type; other files as link chip (existing `drive-embeds.ts`) |
| `[[google:fileId\|label]]` | Teacher-picked Google file — images inline via authenticated proxy URL; Docs/Sheets as link |
| `[text](https://…)` | External URL (GFM) |
| `![alt](https://…)` | External image URL |

Teacher editor: markdown textarea + **Insert from Drive** / **Insert from Google** buttons (reuse Picker patterns). Optional TipTap later — not required for v1.

Student `GET` test: API resolves embed ids to signed/proxied URLs in a `embeds` map (same pattern as notes); never expose raw teacher-only Drive paths.

### 4. Points allocation

Teachers choose per native test material (`native_test_points_mode`):

| Mode | Question fields | Scoring |
|------|-----------------|---------|
| **`explicit`** | `points` per question (default 1) | If `assignment.points_possible` is set: `question_max = (points / sum(points)) × points_possible`. Otherwise raw sum of question points. |
| **`weighted`** | `weight` per question (default 1) | `question_score = (weight / sum(weights)) × assignment.points_possible` |

**Rules:**

- **Weighted mode** requires `assignment.points_possible` to be set; editor shows % preview per question.
- **Explicit mode** shows running sum of relative points; when assignment total is set, auto-grade **scales onto that total** (e.g. 4/5 correct on a 100-pt assignment → 80). Warn (non-blocking) in the editor if relative sum ≠ `points_possible` so teachers notice unequal question weights.
- Auto-grade and manual scores store **earned points** on the question; rollup uses the mode above.
- Teacher may override per-question earned score; rollup recalculates.

### 5. JSON shapes (illustrative)

**`options_json` (multiple choice):**

```json
[
  { "id": "a", "label": "Photosynthesis" },
  { "id": "b", "label": "Respiration" }
]
```

**`correct_answer_json` by type:**

```json
// multiple_choice
{ "optionId": "a" }

// multiple_choice_multi
{ "optionIds": ["a", "c"] }

// true_false
{ "value": true }

// short_answer
{ "accepted": ["mitochondria", "the mitochondria"] }

// long_answer
null
```

**`response_json` (student):**

```json
// multiple_choice
{ "optionId": "a" }

// multiple_choice_multi
{ "optionIds": ["a", "c"] }

// true_false
{ "value": false }

// short_answer
{ "text": "Mitochondria" }

// long_answer
{ "text": "…" }
```

### 6. Attempts and retakes

**Model:** One `school_submissions` row per `(assignment_id, student_member_id)` — same as today. `turn_in_count` increments on each successful `POST /assignments/:id/submit`.

- While drafting, responses use `turn_in_number = submission.turn_in_count + 1`.
- On successful submit, responses for that `turn_in_number` are **locked** (no further PATCH).
- Retake when `max_attempts` allows: student gets a **fresh** response set for the new turn; prior turns remain readable (teacher / student review).

We do **not** create new `school_submissions` rows per attempt (avoids gradebook and submission-list churn). The legacy `attempt_number` column stays unused for native tests until a future migration consolidates attempt semantics.

### 7. Freeze on first household submission

Extend `freezeAssignmentTestMaterials` ([`school-material-freeze.ts`](../../apps/api/src/lib/school-material-freeze.ts)):

For `source = 'native_test'` and `is_test = true`:

1. Load all `school_test_questions` for the material (ordered).
2. Serialize to JSON: `{ "version": 1, "materialId", "frozenAt", "questions": […] }` including `correct_answer_json`.
3. Upload to S3 at `school/{householdId}/materials/{materialId}/snapshot.json`.
4. Set `snapshot_json_s3_key`, `snapshot_content_hash` (hash of canonical JSON), `frozen_at`.

After freeze:

- Teacher question CRUD returns 403.
- Student `GET` test serves **snapshot** questions (prompt + options only; strip answer keys).
- Live DB rows remain for teacher audit but are not served to students post-freeze.

No Google token required for native test freeze.

### 8. API surface (WHO-214–216)

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /assignments/:id/materials` | staff | Create `native_test` shell |
| `GET/POST/PATCH/DELETE …/materials/:materialId/questions` | staff | Question CRUD; block if frozen |
| `GET …/materials/:materialId/questions/preview` | staff | Preview without student leakage |
| `GET …/materials/:materialId/test` | student | Student-safe questions (live or snapshot) |
| `GET …/materials/:materialId/test-responses` | student | Draft/current-turn responses |
| `PATCH …/materials/:materialId/test-responses` | student | Upsert draft (current turn only) |
| `POST /assignments/:id/submit` | student | Existing turn-in; triggers auto-grade + freeze |
| `POST /submissions/:id/grade-question` | staff | Manual score / override per question |

Answer key fields stripped in student serializers at the API boundary (not only UI).

### 9. Auto-grade rules (v1)

Implemented in `school-test-grading.ts`:

| Type | Rule | Partial credit |
|------|------|----------------|
| `multiple_choice` | `response.optionId === correct.optionId` | No (v1) |
| `multiple_choice_multi` | Set equality on `optionIds` | No (v1) |
| `true_false` | Boolean match | No |
| `short_answer` | Normalized text in `correct.accepted[]` or exact match to single value | No |
| `long_answer` | Skip auto; `auto_score` null | N/A |

Normalization: reuse `normalizeTextForHash` (trim, `\r\n` → `\n`, case-insensitive for short answer).

**Rollup:** Per §4 points mode. Unanswered auto-grade questions score **0** on submit (see §12).

On submit:

1. Auto-grade structured responses for current turn.
2. Write/update `school_grades.score` when all questions have a score **or** leave grade null with `needs_manual_grade` flag in submission payload when long-answer items pending.
3. Call `freezeAssignmentTestMaterials` (existing path).

Teacher may override per-question scores; rollup recalculates.

### 10. Student and teacher UX (summary)

| Role | Flow |
|------|------|
| Teacher | Materials → **Create in-app test** → full-page editor (`/school/assignment/:id/materials/:materialId/edit`) → preview · **Export to Google Doc** (WHO-217) |
| Student | Materials card → **Take test** / **Continue test** → in-app form → turn in |
| Teacher | Student work → per-question results, lineage N/A for native; grade long answers |

Native test UI replaces Google **Start test** / **Submit via Google** CTAs when `source = native_test`. Other material types unchanged.

### 11. Export to Google Doc (WHO-217)

One-way export only:

- `POST …/materials/:materialId/export-google-doc` with `{ includeAnswerKey?: boolean }`
- Teacher `google_docs_connections` token; Docs API `documents.create` + `batchUpdate`
- Does not create or sync a live `google_doc` material row
- Graceful 403 when Docs not connected

### 12. Submit validation

- UI **soft-warns** when questions are unanswered before turn-in.
- API **accepts** partial submit; unanswered auto-grade types score **0**; long-answer unanswered stays ungraded until teacher acts.
- No hard block in v1.

### 13. RLS (hosted Starter)

New tables have no direct `household_id`. Policies join through existing school hierarchy (same pattern as `school_submission_google_copies`, migration `0043`):

**`school_test_questions`:**

```sql
EXISTS (
  SELECT 1 FROM school_assignment_materials m
  INNER JOIN school_assignments a ON a.id = m.assignment_id
  INNER JOIN school_classes c ON c.id = a.class_id
  WHERE m.id = school_test_questions.material_id
    AND c.household_id = current_setting('app.current_household_id', true)::uuid
)
```

**`school_submission_responses`:** join via `school_submissions` → `school_assignments` → `school_classes` (same as `school_submission_artifacts`).

Each table also gets `worker_scan` policy for BullMQ jobs.

Self-host (`DEPLOYMENT_MODE=single`): API scoping remains primary; RLS installed for parity.

### 14. Implementation order

| Order | Issue | Deliverable |
|-------|-------|-------------|
| 1 | WHO-213 | This ADR (sign-off) |
| 2 | WHO-214 | Migration `0044`/`0045`, question CRUD API, teacher editor |
| 3 | WHO-215 | Student test taker + draft responses |
| 4 | WHO-216 | Auto-grade on submit + teacher review UI |
| 5 | WHO-217 | Export to Google Doc |

One commit per issue per team policy.

## Consequences

**Positive:**

- Structured homeschool quizzes without Google dependency
- Reuses materials, freeze, submit, gradebook, and visibility matrix from Phases 1–3
- Clear separation: Google path unchanged; native path parallel

**Negative / trade-offs:**

- Two test paradigms on one assignment (Google vs native) — UI must make CTAs unambiguous
- `snapshot_json_s3_key` adds a third snapshot format (binary, text, JSON) — freeze lib grows
- Short-answer grading is brittle (exact/normalized only); teachers use long-answer or MC for nuance

**Risks:**

- Answer key leakage if serializers miss a field — mitigate with dedicated student DTO types and Vitest contract tests
- Retake + draft race: PATCH must validate `turn_in_number` matches current draft turn

## Non-goals (explicit)

- Import Google Doc → native questions
- In-app Google Doc iframe editing
- Google Forms beyond link-only external URL
- AI essay grading
- Question banks / cross-assignment reuse
- Timed tests / lockdown browser

## Resolved decisions (2026-07-10)

| # | Question | Decision |
|---|----------|----------|
| 1 | Points model | **Both:** `explicit` (per-question points) and **`weighted`** (weights scale to `assignment.points_possible`) — teacher picks per test |
| 2 | Rich text | **Markdown** + `[[drive:…]]` / `[[google:…]]` embeds + external links/images — **not HTML** |
| 3 | Submit validation | Soft-warn in UI; API accepts partial; unanswered auto types = 0 |

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Product / owner | Mike | 2026-07-10 | Weighted + explicit points; markdown + embeds; soft-warn submit |

Implementation may proceed with WHO-214.
