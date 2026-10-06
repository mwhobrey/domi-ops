/**
 * Node writes process warnings ("(node:1) MaxListenersExceededWarning: ...", deprecations,
 * experimental features) to stderr, and `captureConsoleIntegration` turns anything on
 * `console.error` into a Sentry error. A warning is not an error: one of them (a listener count
 * on Next's proxy of /api) used up the whole monthly quota in a day (WHO-438). They stay in the
 * container logs; this keeps them out of Sentry. A real exception still reports.
 *
 * apps/web carries its own copy (apps/web/src/lib/sentry-filters.ts) because it does not depend on
 * this package; keep the two in step.
 */
const NODE_PROCESS_WARNING = /^\(node:\d+\) [A-Za-z]*Warning: /;

type EventLike = {
  message?: string;
  logentry?: { message?: string };
  exception?: { values?: Array<{ value?: string }> };
};

export function isNodeProcessWarning(text: string | null | undefined): boolean {
  return typeof text === "string" && NODE_PROCESS_WARNING.test(text);
}

/** `beforeSend` for Sentry.init: drops events that are only a Node process warning, returns the rest as they are. */
export function dropNodeProcessWarnings<T extends EventLike>(event: T): T | null {
  const texts = [event.message, event.logentry?.message, ...(event.exception?.values ?? []).map((v) => v.value)];
  return texts.some(isNodeProcessWarning) ? null : event;
}
