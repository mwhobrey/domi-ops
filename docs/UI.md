# Domi Ops web UI

## Structure

- **Shell:** [`AppShell`](../apps/web/src/components/AppShell.tsx) (server) + [`AppChrome`](../apps/web/src/components/AppChrome.tsx) (client nav with lucide icons, user menu, mobile drawer)
- **Primitives:** [`apps/web/src/components/ui/`](../apps/web/src/components/ui/)
- **Overlays:** native `<dialog>` via `Modal`, `Sheet`, `Drawer` (focus trap, Escape, focus restore)
- **Client API:** [`apps/web/src/lib/client-api.ts`](../apps/web/src/lib/client-api.ts)
- **Server API:** [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
- **List layout:** [`ListPage`](../apps/web/src/components/lists/ListPage.tsx) + [`CollapsibleAddForm`](../apps/web/src/components/lists/CollapsibleAddForm.tsx) (desktop collapsed by default for add forms; always open below `md`)
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
| `SectionHeader`, `PageHeader`, `PageHeaderActions`, `Breadcrumb` | Hierarchy |
| `StatTile` | Dashboard metrics |
| `Avatar`, `Badge`, `Checkbox`, `RadioGroup` | People and forms |
| `Modal`, `Sheet`, `Drawer`, `ConfirmDialog` | Overlays |
| `EmptyState` | Zero-data with optional icon |

## Adding a module page

1. Create `apps/web/src/app/<module>/page.tsx` — wrap in `AppShell` with `title`, optional `description` (`descriptionVisibility`: `desktop` default, `always`, or `never`), `breadcrumb`, `actions`.
2. Fetch with `apiFetch` on the server; pass props to client components for mutations.
3. Use `apiClient` in client components for POST/PATCH/DELETE.
4. Use `ListPage` + `ListItem` + `EmptyState` for list modules.
5. Calendar: agenda-only below `lg`; week grid on desktop (`useIsDesktop`).

## Page chrome

- **`PageHeader`** — `descriptionVisibility`: `desktop` (default when `description` set) hides subtitle below `lg`; list modules omit `description`.
- **`PageHeaderActions`** — when `actions` has 2+ children, below `md` shows an overflow menu instead of a wrapping row.
- **Notices** — `NoticeBoardActions` lives in `AppChrome` header, not `PageHeader`.
- **Desktop nav (coarse pointer)** — icon-only `NavLink` rows use `min-h-11` / `min-w-11` under `@media (pointer: coarse)` at `lg+`.
- **Profile onboarding** — `ProfileOnboardingBanner` when display name unset; dismiss stored per member in `localStorage`.
- **Reports hub** — `/reports` title only; mobile module/kind pill picker card; desktop sidebar nav at `lg+`.

## Dashboard widgets

Layout (top → bottom): **Today at a glance** → **Today’s schedule** + **compact weather** (2-col `md+`) → **Household** → **Month** calendar (secondary).

- **Today at a glance:** actionable tiles only — Chores, Shopping, School (module), Health (module). Drive is not on the dashboard glance. Grid: 2 cols `sm+`, up to 4 at `xl`.
- **Today’s schedule:** `TodayAgenda` — today’s calendar events + overlays; deep-links to `/calendar?event=` or overlay `deepLink`.
- **Weather:** compact strip on dashboard (`WeatherPanel compact`); Open-Meteo via `GET /api/core/weather?lat=&lon=&label=` and geocode; location in `localStorage` (`domi-ops:weather-location`).
- **Household:** `HouseholdPanel` — current user status highlighted; other members below.
- **Month calendar:** `DashboardMonthCalendar` below the fold — tap day for event sheet (hourly weather when location set).

## PWA

- `src/app/manifest.ts` — installable app (`display: standalone`, start `/dashboard`).
- `public/sw.js` + `PwaRegister` — service worker registration.
- Geolocation requires **HTTPS** (or localhost) and works best when installed to home screen.

## Calendar responsive behavior

- **Views:** Month, Week, Day, Agenda on `/calendar` (desktop); mobile uses Month + Agenda (week/day grids hidden to avoid horizontal scroll).
- **Time grid:** Shared `CalendarTimeGrid` — 0:00–24:00, vertical scroll, sticky headers; week (7 columns) and day (1 column).
- **Interaction (desktop week/day):** Click an empty hour slot to create; drag + resize **editable** timed events (15-minute resize snap, hover dot handles); **drag all-day chips** across day columns. Recurring instances prompt **this occurrence vs series** before PATCH (`recurringScope` query). API returns `editable` / `pushable` / `syncStatus` / `recurringRuleId`.
- **Filters:** `CalendarFilterBar` — toggle calendars with events in range (`sessionStorage` `domi-ops:calendar-hidden-lanes`); category pills; **Write to calendar** dropdown (`localStorage` default). Duplicate names collapse to one pill (×N).
- **Event sheet:** sectioned `CalendarEventSheet` — Details, When (time zone in disclosure), Calendar & labels, Repeat (create), Reminders; compact `ColorField`; duplicate/delete.
- **Multi-day:** all-day events render on each spanned day (week grid “continued” styling); month dots reflect overlap count; agenda lists spanning days.
- **Calendar settings:** sync mode, import wizard, **household calendar manager** (create, rename, color, visibility, archive, default, shares).
- **Create:** All-day events can **repeat weekly** (materializes via `recurring.materialize` job).
- **Month:** `CalendarMonthView` (shared with dashboard); day tap opens `CalendarDaySheet` on calendar page (dashboard keeps weather-enriched sheet).
- **Preference:** `sessionStorage` key `domi-ops:calendar-view` (`month|week|day|agenda`).
- Search always forces agenda.
- **Google:** Toolbar calendar icon opens **Calendar settings** sheet (`CalendarGoogleSheet`) — accordion: Google, **Household calendars**, **Event categories**. **Import wizard** — source select + destination calendar + category mapping; OAuth `?import=1`; deep link cleared after successful import. **Sync progress:** `CalendarSyncProgress` + `useCalendarSyncStatus` on calendar page and in sheet while `queued`/`syncing`.
