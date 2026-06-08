# HomeHub chores parity matrix

Comparison of HomeHub todo/chore features vs whome (Jun 2026). **Tracking:** [Chores project](https://linear.app/mikewhob-whome/project/chores-7d0e44ca44bc) WHO-53–WHO-57.

## Source tables (HomeHub)

| HomeHub table | whome target | Notes |
|---------------|--------------|-------|
| `chore` | `chores` | Standalone household chores |
| `todo_item` | `chores` | Imported into same table (list grouping not preserved) |
| `todo_list` | — | List names not modeled in whome v1 |

## Feature matrix

| Feature | HomeHub | whome | Gap / notes |
|---------|---------|-------|-------------|
| Description + done toggle | Yes | Yes | Parity |
| Due date | Yes | Yes | Inline edit on `/chores` |
| Tags (JSON array) | Yes | Yes | Tag chips + comma input; `tags_json` |
| Creator label | `creator` | `created_by_display_name` | Parity via import |
| Assignee | No dedicated column | Yes | `assignee_member_id` → household member |
| Priority | No | Yes | 0–3 (none/low/medium/high) |
| Recurring chores | No | Yes | Daily/weekly/biweekly/monthly templates + materialize on load |
| Filter open / overdue | Partial (UI) | Yes | Filter bar; overdue shown as **Redemption quest** badge |
| Push due/overdue | No | Yes | Worker scan + profile opt-out; overdue push uses redemption framing |
| Multiple todo lists | Yes (`todo_list`) | No | Future: list grouping or tags-as-list |
| Chore reports | No | Yes | `/chores/reports` — completions by person, on-time vs redemption |
| Household Karma | No | Yes | Points + streaks on completion; redemption quests for late chores |
| Dashboard glance | N/A | Yes | `/api/core/chores/glance` + preview lines |

## Import behavior

- `chore` and `todo_item` rows map to `chores` via `packages/import-homehub/src/mappers/tasks.ts`.
- Tags and due dates preserved; assignee/priority/recurring not in HomeHub export.

## Recommended follow-ups (not in Chores M1–M4)

1. **Todo list grouping** — optional `list_id` or tag prefix `list:` if HomeHub list names matter after cutover.
2. **Chore completion history** — `chore_completions` + `/chores/reports` (WHO-102).
3. **Morning digest** — single daily push summarizing all due-today chores instead of per-item scan.
