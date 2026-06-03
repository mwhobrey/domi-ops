# whome web UI

## Structure

- **Shell:** [`AppShell`](../apps/web/src/components/AppShell.tsx) (server) + [`AppChrome`](../apps/web/src/components/AppChrome.tsx) (client nav, user menu, mobile drawer)
- **Primitives:** [`apps/web/src/components/ui/`](../apps/web/src/components/ui/)
- **Client API:** [`apps/web/src/lib/client-api.ts`](../apps/web/src/lib/client-api.ts) — browser `fetch` with credentials and `ApiError`
- **Server API:** [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts) — forwards session cookie on SSR; throws `ApiError`
- **List layout:** [`ListPage`](../apps/web/src/components/lists/ListPage.tsx) — shared add-form card + error dismiss for shopping/chores/notes/expenses
- **Load errors:** [`load-error.ts`](../apps/web/src/lib/load-error.ts) — `loadErrorMessage()` for SSR pages

## Adding a module page

1. Create `apps/web/src/app/<module>/page.tsx` — wrap content in `AppShell` with `title` and optional `description`.
2. Fetch data with `apiFetch` on the server; pass props to a client component for mutations.
3. Use `apiClient` in client components for POST/PATCH/DELETE.
4. Show load failures with `Alert` + retry link, not empty `catch`.
5. Use `EmptyState`, `Card`, `Button`, `Input` from `components/ui`.

## Tokens

Defined in [`globals.css`](../apps/web/src/app/globals.css): surfaces, accent, danger/success, radii, focus ring.
