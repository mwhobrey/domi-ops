/**
 * Input rules shared by the medication supply, pharmacy and pill organizer endpoints (WHO-417).
 *
 * Everything here is a pure function of its input: it either returns the cleaned value or throws a
 * {@link SupplyValidationError} carrying a stable `code` the route turns into a 400. Callers validate
 * the whole request first and write afterwards, because an early error response does not roll back.
 */

export type SupplyValidationCode =
  | "invalid_quantity"
  | "quantity_not_quarter_step"
  | "quantity_out_of_range"
  | "invalid_dose_time"
  | "invalid_dose_quantities"
  | "duplicate_dose_time"
  | "too_many_dose_quantities"
  | "quantities_need_scheduled_medication"
  | "quantity_time_not_scheduled"
  | "invalid_website"
  | "invalid_phone"
  | "invalid_pharmacy_name"
  | "invalid_pharmacy_text";

export class SupplyValidationError extends Error {
  constructor(public readonly code: SupplyValidationCode) {
    super(code);
    this.name = "SupplyValidationError";
  }
}

/** The most pills in one dose. A real dose is far below it; a bigger number is a typo. */
export const MAX_PILLS_PER_DOSE = 100;

/**
 * Pills in a dose, given as a number of pills (0.25, 0.5, 1, 1.5 ...), returned as whole QUARTERS of a
 * pill so sums are exact. Only quarter steps are accepted, more than nothing and at most
 * {@link MAX_PILLS_PER_DOSE}. Numbers only: a string is a client mistake, not a quantity.
 */
export function parsePillQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SupplyValidationError("invalid_quantity");
  const quarters = value * 4;
  const whole = Math.round(quarters);
  // 0.1 + 0.2 style noise is fine; 0.3 is not a quarter.
  if (Math.abs(quarters - whole) > 1e-9) throw new SupplyValidationError("quantity_not_quarter_step");
  if (whole < 1 || whole > MAX_PILLS_PER_DOSE * 4) throw new SupplyValidationError("quantity_out_of_range");
  return whole;
}

/** Whole quarters back to a number of pills for the API: 6 -> 1.5. */
export function quartersToPills(quarters: number): number {
  return quarters / 4;
}

const DOSE_TIME = /^([01]\d|2[0-3]):[0-5]\d(:00)?$/;

/** A dose clock time on a whole minute, as "HH:MM". Seconds other than :00 are refused. */
export function normalizeDoseTime(value: unknown): string {
  if (typeof value !== "string") throw new SupplyValidationError("invalid_dose_time");
  const t = value.trim();
  if (!DOSE_TIME.test(t)) throw new SupplyValidationError("invalid_dose_time");
  return t.slice(0, 5);
}

const MAX_URL_LENGTH = 2048;

/**
 * A pharmacy website that is safe to put behind a link: `http` or `https` only, no embedded
 * credentials, a real host. A bare "walgreens.com" gets `https://`. Anything with another scheme
 * (`javascript:`, `data:`, `mailto:`, `tel:`, `file:` ...) is refused rather than rewritten.
 */
export function normalizeWebsite(value: unknown): string {
  if (typeof value !== "string") throw new SupplyValidationError("invalid_website");
  const raw = value.trim();
  // Whitespace and control characters never belong in a URL (and the parser would quietly drop some).
  // eslint-disable-next-line no-control-regex
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH || /[\x00-\x20\x7f]/.test(raw)) {
    throw new SupplyValidationError("invalid_website");
  }
  // A path or a protocol-relative address is not a website address.
  if (raw.startsWith("/")) throw new SupplyValidationError("invalid_website");
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  // "scheme:rest" without slashes is a scheme unless it is "host:port".
  const bareScheme = !explicitScheme && /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:/]+:\d+(\/|$)/.test(raw);
  // The URL parser below would also refuse most of these (a stray port, embedded credentials), but a
  // scheme such as javascript: is refused here on purpose rather than by accident of how it parses.
  if (bareScheme) throw new SupplyValidationError("invalid_website");

  let url: URL;
  try {
    url = new URL(explicitScheme ? raw : `https://${raw}`);
  } catch {
    throw new SupplyValidationError("invalid_website");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SupplyValidationError("invalid_website");
  if (url.username || url.password) throw new SupplyValidationError("invalid_website");
  const host = url.hostname;
  if (!host || !(host.includes(".") || host.startsWith("["))) throw new SupplyValidationError("invalid_website");
  return url.href;
}

export type NormalizedPhone = {
  /** Shown to people, as typed (trimmed). */
  display: string;
  /** What goes after `tel:` in a link: digits, a leading + if given, and an extension as `;ext=`. */
  tel: string;
};

/**
 * A phone number that makes a working `tel:` link: 7 to 15 digits (the international maximum), the
 * usual separators, an optional leading +, and an optional extension ("x123", "ext. 123", "#123").
 * Letters anywhere else ("1-800-FLOWERS") are refused: they cannot be dialled from a link.
 */
export function normalizePhone(value: unknown): NormalizedPhone {
  if (typeof value !== "string") throw new SupplyValidationError("invalid_phone");
  const display = value.trim();
  if (display.length === 0 || display.length > 40) throw new SupplyValidationError("invalid_phone");

  const extMatch = display.match(/ *(?:ext\.? *|x *|# *)(\d{1,6})$/i);
  const main = extMatch ? display.slice(0, extMatch.index) : display;
  // Plain spaces only (a tab or line break inside a number is never intended), and only a leading +.
  if (!/^\+?[\d ().-]+$/.test(main)) throw new SupplyValidationError("invalid_phone");
  const digits = main.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new SupplyValidationError("invalid_phone");

  const number = `${main.trimStart().startsWith("+") ? "+" : ""}${digits}`;
  return { display, tel: extMatch ? `${number};ext=${extMatch[1]}` : number };
}
