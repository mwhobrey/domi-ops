# whome web UI

## Structure

- **Shell:** [`AppShell`](../apps/web/src/components/AppShell.tsx) (server) + [`AppChrome`](../apps/web/src/components/AppChrome.tsx) (client nav with lucide icons, user menu, mobile drawer)
- **Primitives:** [`apps/web/src/components/ui/`](../apps/web/src/components/ui/)
- **Overlays:** native `<dialog>` via `Modal`, `Sheet`, `Drawer` (focus trap, Escape, focus restore)
- **Client API:** [`apps/web/src/lib/client-api.ts`](../apps/web/src/lib/client-api.ts)
- **Server API:** [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
- **List layout:** [`ListPage`](../apps/web/src/components/lists/ListPage.tsx)
- **Load errors:** [`load-error.ts`](../apps/web/src/lib/load-error.ts)
- **A11y helpers:** [`color-contrast.ts`](../apps/web/src/lib/color-contrast.ts), [`use-media-query.ts`](../apps/web/src/lib/use-media-query.ts)
- **Member colors:** [`member-color.ts`](../apps/web/src/lib/member-color.ts)

## Design tokens (`globals.css`)

| Token | Use |
|-------|-----|
| `--color-surface*` | Page, cards, nested panels |
| `--color-accent*` | CTAs, active nav, highlights |
| `--color-success/warning/danger` | Status, overdue, errors |
| `--header-height` | Sticky agenda headers |
| `--shadow-elevated` | Sheets, dropdowns |
| `bg-page-gradient` | Landing, login, header wash |
| `text-label` | Section headers |

Typography: **Inter** via `next/font` on `layout.tsx`.

## Primitive catalog

| Component | Purpose |
|-----------|---------|
| `Button` / `LinkButton` / `AnchorButton` | Actions and CTAs |
| `Card`, `ListItem` | Containers and rows |
| `SectionHeader`, `PageHeader`, `Breadcrumb` | Hierarchy |
| `StatTile` | Dashboard metrics |
| `Avatar`, `Badge`, `Checkbox`, `RadioGroup` | People and forms |
| `Modal`, `Sheet`, `Drawer`, `ConfirmDialog` | Overlays |
| `EmptyState` | Zero-data with optional icon |

## Adding a module page

1. Create `apps/web/src/app/<module>/page.tsx` — wrap in `AppShell` with `title`, optional `description`, `breadcrumb`, `actions`.
2. Fetch with `apiFetch` on the server; pass props to client components for mutations.
3. Use `apiClient` in client components for POST/PATCH/DELETE.
4. Use `ListPage` + `ListItem` + `EmptyState` for list modules.
5. Calendar: agenda-only below `lg`; week grid on desktop (`useIsDesktop`).

## Dashboard widgets

- **Weather:** Open-Meteo via `GET /api/core/weather?lat=&lon=&label=` and `GET /api/core/weather/geocode?q=`. Users pick **Use my location** (browser geolocation) or search city/state/ZIP; saved in `localStorage` (`whome:weather-location`). Optional server default in `.env`.
- **Household:** `HouseholdPanel` — current user status highlighted; other members below.
- **Month calendar:** `DashboardMonthCalendar` — tap day for event sheet (close via X, backdrop, or Escape).

## PWA

- `src/app/manifest.ts` — installable app (`display: standalone`, start `/dashboard`).
- `public/sw.js` + `PwaRegister` — service worker registration.
- Geolocation requires **HTTPS** (or localhost) and works best when installed to home screen.

## Calendar responsive behavior

- **Views:** Month, Week, Day, Agenda on `/calendar` (desktop); mobile uses Month + Agenda (week/day grids hidden to avoid horizontal scroll).
- **Time grid:** Shared `CalendarTimeGrid` — 0:00–24:00, vertical scroll, sticky headers; week (7 columns) and day (1 column).
- **Interaction (desktop week/day):** Click an empty hour slot to create; drag + resize **editable** timed events (15-minute resize snap, hover dot handles); **drag all-day chips** across day columns. Recurring instances prompt **this occurrence vs series** before PATCH (`recurringScope` query). API returns `editable` / `pushable` / `syncStatus` / `recurringRuleId`.
- **Filters:** `CalendarFilterBar` — toggle calendars with events in range (`sessionStorage` `whome:calendar-hidden-lanes`); category pills; **Write to calendar** dropdown (`localStorage` default). Duplicate names collapse to one pill (×N).
- **Event sheet:** sectioned `CalendarEventSheet` — Details, When (time zone in disclosure), Calendar & labels, Repeat (create), Reminders; compact `ColorField`; duplicate/delete.
- **Multi-day:** all-day events render on each spanned day (week grid “continued” styling); month dots reflect overlap count; agenda lists spanning days.
- **Calendar settings:** sync mode, import wizard, **household calendar manager** (create, rename, color, visibility, archive, default, shares).
- **Create:** All-day events can **repeat weekly** (materializes via `recurring.materialize` job).
- **Month:** `CalendarMonthView` (shared with dashboard); day tap opens `CalendarDaySheet` on calendar page (dashboard keeps weather-enriched sheet).
- **Preference:** `sessionStorage` key `whome:calendar-view` (`month|week|day|agenda`).
- Search always forces agenda.
- **Google:** Toolbar calendar icon opens **Calendar settings** sheet (`CalendarGoogleSheet`) — accordion: Google, **Household calendars**, **Event categories**. **Import wizard** — source select + destination calendar + category mapping; OAuth `?import=1`; deep link cleared after successful import. **Sync progress:** `CalendarSyncProgress` + `useCalendarSyncStatus` on calendar page and in sheet while `queued`/`syncing`.
