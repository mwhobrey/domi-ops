# HomeHub chores parity matrix

Comparison of HomeHub todo/chore features vs whome (Jun 2026). **Tracking:** [Chores project](https://linear.app/mikewhob-whome/project/chores-7d0e44ca44bc) WHO-53–WHO-57.

## Source tables (HomeHub)

| HomeHub table | whome target | Notes |
|---------------|--------------|-------|
| `chore` | `chores` | Standalone household chores |
| `todo_item` | `chores` | Imported into same table (list grouping not preserved) |
| `todo_list` | `tags_json` `list:` prefix | HomeHub list name stored as `list:<name>` tag |

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
| Multiple todo lists | Yes (`todo_list`) | Yes | `list:` tag prefix; import maps `todo_list_id` → name; `/chores` list filter + group-by |
| Chore reports | No | Yes | `/chores/reports` — completions by person, on-time vs redemption |
| Household Karma | No | Yes | Points + streaks on completion; redemption quests for late chores |
| Dashboard glance | N/A | Yes | `/api/core/chores/glance` + preview lines |

## Import behavior

- `chore` and `todo_item` rows map to `chores` via `packages/import-homehub/src/mappers/tasks.ts`.
- Tags and due dates preserved; assignee/priority/recurring not in HomeHub export.

## Recommended follow-ups

1. **Morning digest** — single daily push summarizing all due-today chores instead of per-item scan.
2. **Re-import list migration** — households imported before WHO-98 may still have `[ListName]` in descriptions; optional one-off script to move into `list:` tags.
