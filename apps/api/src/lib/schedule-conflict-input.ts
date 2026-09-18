/** Upper bound for any drive-time buffer (persisted or ad-hoc). Query padding derives from this. */
export const MAX_DRIVE_BUFFER_MINUTES = 24 * 60;

export class ScheduleConflictInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleConflictInputError";
  }
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type BufferParse =
  | { ok: true; value: number | null | undefined }
  | { ok: false };

/** Omitted and null pass through; anything else must be an integer in [0, MAX_DRIVE_BUFFER_MINUTES]. */
export function parseDriveBufferMinutes(value: unknown): BufferParse {
  if (value === undefined || value === null) return { ok: true, value };
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DRIVE_BUFFER_MINUTES
  ) {
    return { ok: true, value };
  }
  return { ok: false };
}
