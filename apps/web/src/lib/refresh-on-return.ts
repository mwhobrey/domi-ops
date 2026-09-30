/** Away this long (ms) before coming back counts as "the page may be stale". */
export const STALE_AFTER_MS = 60_000;

/** Put on any element to stop the page from auto-refreshing while it is mounted. */
export const NO_AUTO_REFRESH_ATTR = "data-no-auto-refresh";

export function shouldRefreshOnReturn(input: {
  /** ms since the tab was hidden or blurred, or null if we never saw it leave. */
  awayMs: number | null;
  busy: boolean;
}): boolean {
  if (input.awayMs === null || input.busy) return false;
  return input.awayMs >= STALE_AFTER_MS;
}

const TEXT_INPUT_TYPES = new Set(["text", "email", "url", "tel", "number", "password", "date", "datetime-local", "time", "search"]);

/** True for a field a person types into. Checkboxes and buttons are not "half-typed" work. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return target.isContentEditable;
}

/**
 * True when refreshing would be rude: an open dialog/sheet, an opted-out page, or something the
 * user typed that hasn't been saved. Typing is tracked from real input events rather than by
 * reading field values, because plenty of pages pre-fill fields (date ranges, settings) and those
 * would otherwise block refreshing forever.
 */
export function isUserBusy(doc: Document, userEdited: boolean): boolean {
  if (userEdited) return true;
  return doc.querySelector(`dialog[open], [aria-modal="true"], [${NO_AUTO_REFRESH_ATTR}]`) !== null;
}
