# Linear workspace — whome (WHO)

**Team:** [Whome](https://linear.app/mikewhob-whome/team/WHO) · key `WHO`  
**MCP:** Cursor plugin `user-linear-whome` (`set_active_team` → `WHO`)

## Workflow states

Configured on the WHO team (issue workflow):

| State | Type | Use |
|--------|------|-----|
| Backlog | backlog | Ideas not scheduled |
| Todo | unstarted | Ready to start |
| In Progress | started | Active work |
| Done | completed | Shipped / verified |
| Canceled | canceled | Declined |
| Duplicate | duplicate | Duplicate of another issue |

**Recommended (manual in Linear):** add **In Review** between In Progress and Done (Settings → Teams → Whome → Issue statuses). The MCP cannot create workflow states.

## Label taxonomy

Three **groups** — apply **at most one child label per group** per issue:

### Type

| Label | Use |
|--------|-----|
| enhancement | Features and UX improvements (use when Bug/Feature workspace labels unavailable) |
| chore | Tooling, docs-only, housekeeping |

Workspace-level **Bug** / **Feature** may exist; attach in Linear UI if needed. Team labels include `enhancement` and `chore` under group **Type**.

### Area

| Label | Layer |
|--------|--------|
| web | `apps/web` |
| api | `apps/api` |
| db | `packages/db`, migrations |
| worker | `apps/worker` |
| docs | Markdown / runbook |
| storage | S3 / MinIO |

### Domain

| Label | Product area |
|--------|----------------|
| household | Presence, who's home |
| profile | Profile page / prefs |
| weather | Forecast widget |
| notifications | Notice board, push |
| pwa | Service worker / install |
| dx | Developer experience |

## Projects & milestones

### [Profile & identity](https://linear.app/mikewhob-whome/project/profile-and-identity-97eab05fe11c)

| Milestone | Issues |
|-----------|--------|
| M1 — Presence (Home/Away + message) | [WHO-6](https://linear.app/mikewhob-whome/issue/WHO-6) |
| M2 — Profile preferences | [WHO-7](https://linear.app/mikewhob-whome/issue/WHO-7) |
| M3 — Profile photos | [WHO-8](https://linear.app/mikewhob-whome/issue/WHO-8) |
| M4 — Profile UX redesign | [WHO-16](https://linear.app/mikewhob-whome/issue/WHO-16), [WHO-17](https://linear.app/mikewhob-whome/issue/WHO-17), [WHO-18](https://linear.app/mikewhob-whome/issue/WHO-18) |
| M5 — Better Auth & accounts | [WHO-88](https://linear.app/mikewhob-whome/issue/WHO-88) (migration + username), [WHO-89](https://linear.app/mikewhob-whome/issue/WHO-89) (email verification) |

### [Dashboard & weather](https://linear.app/mikewhob-whome/project/dashboard-and-weather-b7a05f35afba)

| Milestone | Issues |
|-----------|--------|
| M1 — Weather reliability | [WHO-5](https://linear.app/mikewhob-whome/issue/WHO-5) |
| M2 — Weather in day schedule | [WHO-12](https://linear.app/mikewhob-whome/issue/WHO-12) |
| M3 — At-a-glance density | [WHO-13](https://linear.app/mikewhob-whome/issue/WHO-13) |

### [Notifications](https://linear.app/mikewhob-whome/project/notifications-9c965c13ece0)

| Milestone | Issues |
|-----------|--------|
| (shipped reference) | [WHO-11](https://linear.app/mikewhob-whome/issue/WHO-11) Notice board MVP |
| M1 — Web Push | [WHO-10](https://linear.app/mikewhob-whome/issue/WHO-10) |

### [DevEx & platform](https://linear.app/mikewhob-whome/project/devex-and-platform-2b8c7de9daa6)

| Milestone | Issues |
|-----------|--------|
| M1 — DB & runbook hygiene | [WHO-9](https://linear.app/mikewhob-whome/issue/WHO-9) |
| M2 — Dev ports & OAuth | [WHO-14](https://linear.app/mikewhob-whome/issue/WHO-14), [WHO-15](https://linear.app/mikewhob-whome/issue/WHO-15) |
| M3 — HomeHub import | [WHO-90](https://linear.app/mikewhob-whome/issue/WHO-90) (single-pass `home_status` stubs) |

### [Calendar](https://linear.app/mikewhob-whome/project/calendar-f2b23dc55276)

| Milestone | Issues |
|-----------|--------|
| M1 — Views & navigation | [WHO-26](https://linear.app/mikewhob-whome/issue/WHO-26)–[WHO-28](https://linear.app/mikewhob-whome/issue/WHO-28) |
| M2 — Interaction | [WHO-29](https://linear.app/mikewhob-whome/issue/WHO-29)–[WHO-34](https://linear.app/mikewhob-whome/issue/WHO-34) |
| M3 — Google UX | [WHO-31](https://linear.app/mikewhob-whome/issue/WHO-31)–[WHO-35](https://linear.app/mikewhob-whome/issue/WHO-35), [WHO-75](https://linear.app/mikewhob-whome/issue/WHO-75) |
| M4 — HomeHub parity | [WHO-33](https://linear.app/mikewhob-whome/issue/WHO-33)–[WHO-40](https://linear.app/mikewhob-whome/issue/WHO-40) |

### [School](https://linear.app/mikewhob-whome/project/school-28fede3d2344)

| Milestone | Issues |
|-----------|--------|
| M1 — Parity audit | [WHO-41](https://linear.app/mikewhob-whome/issue/WHO-41), [WHO-48](https://linear.app/mikewhob-whome/issue/WHO-48) |
| M2 — Class & roster UX | [WHO-42](https://linear.app/mikewhob-whome/issue/WHO-42), [WHO-43](https://linear.app/mikewhob-whome/issue/WHO-43) |
| M3 — Assignments & grading | [WHO-44](https://linear.app/mikewhob-whome/issue/WHO-44)–[WHO-46](https://linear.app/mikewhob-whome/issue/WHO-46) |
| M4 — Role-aware views | [WHO-47](https://linear.app/mikewhob-whome/issue/WHO-47) |
| M5 — QA runbook | [WHO-87](https://linear.app/mikewhob-whome/issue/WHO-87) (`.cursor/runbook/05_SCHOOL_QA.md`) |

### [Shopping](https://linear.app/mikewhob-whome/project/shopping-418cd7a0c63a)

| Milestone | Issues |
|-----------|--------|
| M1 — Smart add | [WHO-49](https://linear.app/mikewhob-whome/issue/WHO-49) |
| M2 — List quality | [WHO-50](https://linear.app/mikewhob-whome/issue/WHO-50)–[WHO-52](https://linear.app/mikewhob-whome/issue/WHO-52) |
| M3 — UX polish | [WHO-51](https://linear.app/mikewhob-whome/issue/WHO-51) |
| M4 — Expansion | [WHO-92](https://linear.app/mikewhob-whome/issue/WHO-92) (recurring), [WHO-93](https://linear.app/mikewhob-whome/issue/WHO-93) (aisle combobox), [WHO-94](https://linear.app/mikewhob-whome/issue/WHO-94) (edit), [WHO-95](https://linear.app/mikewhob-whome/issue/WHO-95) (reports), [WHO-96](https://linear.app/mikewhob-whome/issue/WHO-96) (receipt), [WHO-97](https://linear.app/mikewhob-whome/issue/WHO-97) (cost/expense) |

### [Chores](https://linear.app/mikewhob-whome/project/chores-7d0e44ca44bc)

| Milestone | Issues |
|-----------|--------|
| M1 — Data model & API | [WHO-54](https://linear.app/mikewhob-whome/issue/WHO-54), [WHO-55](https://linear.app/mikewhob-whome/issue/WHO-55) |
| M2 — List UX | [WHO-53](https://linear.app/mikewhob-whome/issue/WHO-53) |
| M3 — Notifications | [WHO-56](https://linear.app/mikewhob-whome/issue/WHO-56) |
| M4 — HomeHub parity | [WHO-57](https://linear.app/mikewhob-whome/issue/WHO-57) |

### [Notes](https://linear.app/mikewhob-whome/project/notes-7c7c0d852010)

| Milestone | Issues |
|-----------|--------|
| M1 — Editor | [WHO-58](https://linear.app/mikewhob-whome/issue/WHO-58), [WHO-59](https://linear.app/mikewhob-whome/issue/WHO-59) |
| M2 — Scope & sharing | [WHO-60](https://linear.app/mikewhob-whome/issue/WHO-60), [WHO-61](https://linear.app/mikewhob-whome/issue/WHO-61) |
| M3 — Organization | [WHO-62](https://linear.app/mikewhob-whome/issue/WHO-62) |
| M4 — CRUD & HomeHub parity | [WHO-63](https://linear.app/mikewhob-whome/issue/WHO-63), [WHO-64](https://linear.app/mikewhob-whome/issue/WHO-64) |

### [Household expenses](https://linear.app/mikewhob-whome/project/household-expenses-32c1cca7f76f)

| Milestone | Issues |
|-----------|--------|
| M1 — CRUD polish | [WHO-65](https://linear.app/mikewhob-whome/issue/WHO-65), [WHO-66](https://linear.app/mikewhob-whome/issue/WHO-66) |
| M2 — Budgets | [WHO-67](https://linear.app/mikewhob-whome/issue/WHO-67) |
| M3 — Balances (spike) | [WHO-68](https://linear.app/mikewhob-whome/issue/WHO-68) |
| M4 — Budget alerts | [WHO-69](https://linear.app/mikewhob-whome/issue/WHO-69) |

### [Admin & household settings](https://linear.app/mikewhob-whome/project/admin-and-household-settings-ae21ffeebe2c)

| Milestone | Issues |
|-----------|--------|
| M1 — Admin shell | [WHO-70](https://linear.app/mikewhob-whome/issue/WHO-70) |
| M2 — Household settings | [WHO-71](https://linear.app/mikewhob-whome/issue/WHO-71), [WHO-73](https://linear.app/mikewhob-whome/issue/WHO-73) |
| M3 — Modules | [WHO-72](https://linear.app/mikewhob-whome/issue/WHO-72) |
| M4 — Integrations | [WHO-74](https://linear.app/mikewhob-whome/issue/WHO-74) |

## Suggested work order

1. [DevEx](https://linear.app/mikewhob-whome/project/devex-and-platform-2b8c7de9daa6) **WHO-14** (ports) — unblocks calendar OAuth.
2. [Calendar](https://linear.app/mikewhob-whome/project/calendar-f2b23dc55276) views + interaction, then Google UX.
3. Core list modules (Shopping → Chores → Notes → Expenses) as you dogfood each tab.
4. [School](https://linear.app/mikewhob-whome/project/school-28fede3d2344) makeover after parity doc.
5. [Admin](https://linear.app/mikewhob-whome/project/admin-and-household-settings-ae21ffeebe2c) when household controls matter.

## Agent workflow

See `.cursor/rules/linear-workflow.mdc` and `.cursorrules` (Linear section).

1. Find or create a WHO issue before non-trivial work.
2. Move to **In Progress**.
3. Commit with `WHO-n` in the message when committing.
4. Comment + **Done** when finished.

## Backlog source

Detailed acceptance criteria: `docs/LINEAR_BACKLOG.md` (keep in sync when adding large new specs).
