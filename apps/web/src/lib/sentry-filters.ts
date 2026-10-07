/**
 * Node process warnings ("(node:1) MaxListenersExceededWarning: ...") reach Sentry as errors
 * through `captureConsoleIntegration`. A warning is not an error and one of them used up a whole
 * month of Sentry quota (WHO-438); they stay in the container logs. A real exception still reports.
 *
 * A copy of packages/config/src/sentry-filters.ts (the API and worker use that one): the web app
 * does not depend on @domi-ops/config, so keep the two in step.
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
