import * as Sentry from "@sentry/nextjs";
import { dropNodeProcessWarnings } from "./lib/sentry-filters";
import { DIAGNOSTIC_DATA_COLLECTION, scrubDiagnosticEvent } from "@domi-ops/config/diagnostics";

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
    // Node process warnings are not errors (WHO-438); they stay in the container logs.
    maxBreadcrumbs: 0, tracesSampleRate: 0, attachStacktrace: true,
    dataCollection: DIAGNOSTIC_DATA_COLLECTION,
    ignoreSpans: [/.*/],
    tracePropagationTargets: [],
    beforeSendLog: () => null, beforeSendMetric: () => null,
    beforeSend: (event, hint) => { hint.attachments = []; return dropNodeProcessWarnings(event) ? scrubDiagnosticEvent(event) : null; },
  });
}
