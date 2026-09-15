import * as Sentry from "@sentry/nextjs";

/** WHO-292 — Edge runtime (middleware / edge routes). Same optional DSN as server. */
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
  });
}
