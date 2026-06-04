# Calendar event parity (HomeHub → whome)

## HomeHub SQLite → whome Postgres

| HomeHub | whome | UI |
|---------|-------|-----|
| `personal_calendar` | `calendars` | Lane filter + sheet lane select |
| `reminder.title` | `calendar_events.title` | Event sheet |
| `reminder.description` | `calendar_events.description` | Event sheet |
| `reminder.category` | `calendar_events.category_key` + `event_categories` | Sheet category select |
| `reminder.color` | `calendar_events.color` | Sheet + grid chips |
| `reminder.date` / `end_date` | `start_date` / `end_date` | Sheet + multi-day grid |
| `reminder.time` / `end_time` | `start_time` / `end_time` | Sheet + timed grid |
| `reminder.all_day` | `all_day` | Sheet toggle |
| `reminder.personal_calendar_id` | `calendar_id` | Lane assignment |
| `reminder.source` / `google_event_id` | `source` / `google_event_id` | Sync policy |
| `recurring_reminder` | `recurring_rules` + materialized `calendar_events` | Repeat builder + scope sheet |

## QA checklist

- [ ] Imported event shows description, category, color, end date
- [ ] Multi-day all-day event spans week/month columns
- [ ] Category filter pills hide/show by `categoryKey`
- [ ] `recurring_reminder` import produces instances in range
- [ ] Drag/delete recurring prompts this vs series
- [ ] `event_categories` CRUD + assign on create
- [ ] Reminder push 15m before start (profile toggle)
- [ ] Duplicate event creates local copy without Google id
