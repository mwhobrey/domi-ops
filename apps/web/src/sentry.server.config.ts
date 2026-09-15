import * as Sentry from "@sentry/nextjs";

/**
 * WHO-292 — Next.js Node runtime. Uses the same optional SENTRY_DSN as api/worker
 * (already on the web container via compose env_file).
 */
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}
