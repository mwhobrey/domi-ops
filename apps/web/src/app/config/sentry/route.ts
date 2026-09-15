/**
 * WHO-292 — public client DSN for browser Sentry.
 * Client DSNs are designed to be public. Served from Next (not Hono `/api/*`) so the
 * web container's runtime `SENTRY_DSN` works even when the GHCR image was built without it.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || null;
  return Response.json(
    { dsn },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
