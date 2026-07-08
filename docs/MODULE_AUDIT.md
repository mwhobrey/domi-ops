# Module audit (Jun 2026)

Quick-pass evaluation from dogfooding Domi Ops vs HomeHub expectations. **Source of truth for work tracking:** Linear projects (see [`docs/LINEAR.md`](LINEAR.md)).

## Projects created (WHO-14 … WHO-75)

| Tab / area | Linear project | Issue range |
|------------|----------------|-------------|
| Dev ports & OAuth | [DevEx & platform](https://linear.app/mikewhob-whome/project/devex-and-platform-2b8c7de9daa6) | WHO-14, WHO-15 |
| Profile UX | [Profile & identity](https://linear.app/mikewhob-whome/project/profile-and-identity-97eab05fe11c) | WHO-16–WHO-18 |
| Calendar | [Calendar](https://linear.app/mikewhob-whome/project/calendar-f2b23dc55276) | WHO-26–WHO-40, WHO-75 |
| School | [School](https://linear.app/mikewhob-whome/project/school-28fede3d2344) | WHO-41–WHO-48 |
| Shopping | [Shopping](https://linear.app/mikewhob-whome/project/shopping-418cd7a0c63a) | WHO-49–WHO-52 |
| Chores | [Chores](https://linear.app/mikewhob-whome/project/chores-7d0e44ca44bc) | WHO-53–WHO-57 |
| Notes | [Notes](https://linear.app/mikewhob-whome/project/notes-7c7c0d852010) | WHO-58–WHO-64 |
| Expenses | [Household expenses](https://linear.app/mikewhob-whome/project/household-expenses-32c1cca7f76f) | WHO-65–WHO-69 |
| Admin | [Admin & household settings](https://linear.app/mikewhob-whome/project/admin-and-household-settings-ae21ffeebe2c) | WHO-70–WHO-74 |

Shipped earlier (core/dashboard): WHO-5–WHO-13, WHO-6–WHO-10, WHO-9, WHO-11.

## Code anchors (current MVP)

| Module | Route | Primary UI | API |
|--------|-------|------------|-----|
| Calendar | `/calendar` | `CalendarPageClient`, `CalendarWeek` | `/api/calendar/*` |
| School | `/school` | `SchoolClassList`, class/assignment pages | `/api/school/*` |
| Shopping | `/shopping` | `ShoppingList` | `/api/core/shopping` |
| Chores | `/chores` | `ChoresList` | `/api/core/chores` |
| Notes | `/notes` | `NotesList` | `/api/core/notes` |
| Expenses | `/expenses` | `ExpensesList` | `/api/core/expenses` |
| Profile | `/profile` | `ProfileEditor` | `/api/core/profile` |
| Admin | — | *none* | *partial via profile role* |

When fixing issues during dogfood, add new WHO issues to the matching project and link in PR/commit.
