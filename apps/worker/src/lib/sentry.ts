import * as Sentry from "@sentry/node";
import type { Env } from "@domi-ops/config";

/**
 * WHO-253 — see apps/api/src/lib/sentry.ts for the full rationale; same pattern here. No-op if
 * SENTRY_DSN is unset.
 */
export function initSentry(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}
