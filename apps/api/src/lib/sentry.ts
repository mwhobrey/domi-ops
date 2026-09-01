import * as Sentry from "@sentry/node";
import type { Env } from "@domi-ops/config";

/**
 * WHO-253 — every real bug found this session (the event_categories race, the silent
 * calendar-push failure, the WHO-250 credential mismatch) was found by manually SSHing into
 * hosted-prod and grepping docker logs mid-investigation. None of it reached anyone
 * automatically. This wires that up.
 *
 * No-op if SENTRY_DSN is unset (same optional-env pattern as SMTP_* / GOOGLE_OAUTH_*) — local
 * dev and any deployment that hasn't configured Sentry yet just runs without it.
 *
 * captureConsoleIntegration means every existing `console.error(...)` call site across the
 * app (there are dozens) starts reporting to Sentry with zero further changes — the exact gap
 * WHO-253 exists to close, without needing to touch every call site individually (see WHO-257
 * for the separate, smaller task of auditing which of those call sites even matter).
 */
export function initSentry(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}
