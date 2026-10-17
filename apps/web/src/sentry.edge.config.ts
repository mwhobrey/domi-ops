import * as Sentry from "@sentry/nextjs";
import { DIAGNOSTIC_DATA_COLLECTION, scrubDiagnosticEvent } from "@domi-ops/config/diagnostics";

/** WHO-292 — Edge runtime (middleware / edge routes). Same optional DSN as server. */
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false, maxBreadcrumbs: 0, tracesSampleRate: 0,
    dataCollection: DIAGNOSTIC_DATA_COLLECTION, enableLogs: false,
    ignoreSpans: [/.*/],
    tracePropagationTargets: [],
    beforeSendLog: () => null, beforeSendMetric: () => null,
    beforeSendTransaction: () => null,
    beforeSend: (event, hint) => { hint.attachments = []; return scrubDiagnosticEvent(event); },
  });
}
