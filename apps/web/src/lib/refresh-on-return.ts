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

const TEXT_INPUT_TYPES = new Set(["text", "email", "url", "tel", "number", "password", "date", "datetime-local", "time"]);

/**
 * True when refreshing would be rude: an open dialog/sheet, an opted-out page, or anything
 * half-typed. Conservative on purpose. Re-seeding client state from fresh props would wipe it.
 */
export function isUserBusy(doc: Document): boolean {
  if (doc.querySelector(`dialog[open], [aria-modal="true"], [${NO_AUTO_REFRESH_ATTR}]`)) return true;

  for (const el of doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("main input, main textarea")) {
    if (el instanceof HTMLTextAreaElement) {
      if (el.value.trim() !== "") return true;
    } else if (TEXT_INPUT_TYPES.has(el.type) && el.value.trim() !== "") {
      return true;
    }
  }
  for (const el of doc.querySelectorAll<HTMLElement>('main [contenteditable="true"]')) {
    if ((el.textContent ?? "").trim() !== "") return true;
  }
  return false;
}
