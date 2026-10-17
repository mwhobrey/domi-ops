/** Shared collector/client allowlist. Never transport record IDs, errors or free text. */
const ROUTES = new Set(["dashboard", "school", "health", "calendar", "drive", "goals", "chores", "shopping", "expenses", "settings", "profile", "notices"]);
const USAGE = new Set(["page.viewed", "school.assignment_created", "health.entry_created", "household.invitation_accepted", "chore.completed"]);
export function telemetryRoute(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const first = path.split(/[/?#]/)[1];
  return ROUTES.has(first) ? `/${first}` : null;
}
export function privateTelemetryFields(event: { kind?: unknown; name?: unknown; path?: unknown; value?: unknown; metadata?: unknown }) {
  const kind = event.kind;
  let name: string;
  let metadata: { rating: string } | null = null;
  if (kind === "error") name = event.name === "unhandled_rejection" ? "unhandled_rejection" : "browser_error";
  else if (kind === "web_vital" && typeof event.name === "string" && ["CLS", "INP", "LCP", "FCP", "TTFB"].includes(event.name)) {
    name = event.name;
    const rating = (event.metadata as { rating?: unknown } | null)?.rating;
    if (typeof rating === "string" && ["good", "needs-improvement", "poor"].includes(rating)) metadata = { rating };
  } else if (kind === "usage" && typeof event.name === "string" && USAGE.has(event.name)) name = event.name;
  else return null;
  return { kind, name, path: telemetryRoute(event.path), value: kind === "web_vital" && typeof event.value === "number" && Number.isFinite(event.value) ? Math.max(0, Math.min(2147483647, Math.round(event.value))) : null, metadata };
}
