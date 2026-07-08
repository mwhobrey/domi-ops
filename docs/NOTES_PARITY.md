# HomeHub notes parity matrix

Comparison of HomeHub note features vs Domi Ops (Jun 2026). **Tracking:** [Notes project](https://linear.app/mikewhob-whome/project/notes-7c7c0d852010) WHO-58–WHO-64.

## Source table (HomeHub)

| HomeHub table | Domi Ops target | Notes |
|---------------|--------------|-------|
| `note` | `notes` | Single household notes list |

HomeHub SQLite columns (production `app.db`, Jun 2026): `id`, `content`, `creator`, `timestamp`. No `title`, `tags`, or `visibility` columns in export.

## Feature matrix

| Feature | HomeHub | Domi Ops | Gap / notes |
|---------|---------|-------|-------------|
| Create note | Yes | Yes | Parity |
| Note title | No (content only) | Yes | Required on create; card heading on `/notes` |
| Pin to top | No | Yes | `pinned` boolean; sort pinned first; toggle on card + edit sheet |
| Edit note | Yes | Yes | Edit sheet (`NoteEditSheet`) |
| Delete note | Yes | Yes | Parity |
| Markdown compose | Plain textarea | Yes | Write/Rich/Preview tabs (`MarkdownEditor`); raw Write + TipTap Rich (markdown round-trip) + `react-markdown` GFM Preview |
| WYSIWYG editor | No | Yes | **WHO-59** — `MarkdownRichEditor` (TipTap + `@tiptap/markdown`); storage remains markdown |
| Expand / collapse preview | Partial | Yes | Plain-text excerpt + expand on long notes |
| Creator label | `creator` | `created_by_display_name` | Parity via import |
| Created timestamp | `timestamp` | `created_at` | Parity via import (preserves HomeHub time) |
| Tags | No | Yes | `tags_json`; chips + comma input; domi-ops-only |
| Search + tag filter | No | Yes | `GET /notes?q=&tag=` matches **title and content**; domi-ops-only |
| Visibility (private / household) | No | Yes | `note_visibility` enum; domi-ops-only |
| Per-member sharing | No | Yes | `note_shares` on private notes; domi-ops-only |
| Author + timestamp footer | Partial | Yes | Card footer on `/notes` |

## Import behavior

- `note` rows map to `notes` via `packages/import-homehub/src/mappers/notes.ts`.
- **Mapped:** `content`, `creator` → `created_by_display_name`, `timestamp` → `created_at`.
- **Title on import:** optional SQLite `title` → `notes.title`; when absent, first non-empty content line (or truncated content, else `Untitled`).
- **Optional columns** (schema drift): if present in SQLite, `tags` → `tags_json`, `visibility` → `visibility` (`private` \| `household`).
- **Defaults on import:** `visibility` = `household`, `tags_json` = `[]`, `pinned` = `false` when columns absent.
- **`created_by_user_id`:** not set on import (display name only); private-note ownership applies to notes created in Domi Ops after cutover.
- Idempotent via `import_records` (`source_table` = `note`).

## Recommended follow-ups

1. **Import re-run note** — already-imported rows skip via `import_records`; timestamp/tags fixes apply only to new imports unless mapper is extended to upsert.
2. **Rich editor polish** — tables/GFM task lists not in toolbar; `@tiptap/markdown` is early-release (possible round-trip edge cases vs `remark-gfm` Preview).
