import { addDaysUtc } from "@domi-ops/calendar-sync";
import { normalizeDoseTime } from "./health-supply-validation.js";
import { HEALTH_CAPS } from "./health-quota.js";

/**
 * Input rules for pill organizer plans (WHO-424). Everything here is a pure function of its input: it
 * returns the cleaned value or throws an {@link OrganizerValidationError} carrying a stable `code` the
 * route turns into a 400 (or 409 for a limit). Callers validate the whole request first and write after,
 * because an early error response does not roll back what was already written.
 */

export type OrganizerValidationCode =
  | "invalid_body"
  | "invalid_schedule_kind"
  | "invalid_every_n"
  | "invalid_monthly_day"
  | "invalid_anchor_date"
  | "invalid_fill_length"
  | "invalid_reminder_time"
  | "invalid_compartments"
  | "invalid_compartment_name"
  | "duplicate_compartment_name"
  | "compartment_not_found"
  | "too_many_compartments"
  | "invalid_time_map"
  | "invalid_caregivers"
  | "invalid_group_assignment"
  | "invalid_version";

export class OrganizerValidationError extends Error {
  constructor(public readonly code: OrganizerValidationCode) {
    super(code);
    this.name = "OrganizerValidationError";
  }
}

const fail = (code: OrganizerValidationCode): never => {
  throw new OrganizerValidationError(code);
};

export const MAX_FILL_LENGTH_DAYS = 93;
export const DEFAULT_FILL_LENGTH_DAYS = 31;
export const DEFAULT_REMINDER_TIME = "09:00";
export const DEFAULT_COMPARTMENT_NAMES = ["Morning", "Lunch", "Supper", "Night"] as const;
export const MAX_CAREGIVERS = 20;
export const MAX_COMPARTMENT_NAME_LENGTH = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export type PlanSchedule =
  | { scheduleKind: "every_n_days"; everyN: number; monthlyDay: null }
  | { scheduleKind: "monthly_date"; monthlyDay: number; everyN: null };

/**
 * The schedule a request ends up with: the request's fields laid over what the plan already has (if
 * anything). Switching kind drops the other kind's number, so a plan is never left with both.
 */
export function resolveSchedule(
  existing: PlanSchedule | null,
  input: { scheduleKind?: unknown; everyN?: unknown; monthlyDay?: unknown },
): PlanSchedule {
  const kind = input.scheduleKind !== undefined ? input.scheduleKind : existing?.scheduleKind;
  if (kind === "every_n_days") {
    const everyN = input.everyN !== undefined ? input.everyN : existing?.everyN;
    if (!isInt(everyN, 1, 365)) return fail("invalid_every_n");
    return { scheduleKind: "every_n_days", everyN, monthlyDay: null };
  }
  if (kind === "monthly_date") {
    const monthlyDay = input.monthlyDay !== undefined ? input.monthlyDay : existing?.monthlyDay;
    if (!isInt(monthlyDay, 1, 31)) return fail("invalid_monthly_day");
    return { scheduleKind: "monthly_date", monthlyDay, everyN: null };
  }
  return fail("invalid_schedule_kind");
}

/** A real calendar day, "YYYY-MM-DD". */
export function parseAnchorDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail("invalid_anchor_date");
  try {
    addDaysUtc(value, 0);
  } catch {
    return fail("invalid_anchor_date");
  }
  return value;
}

export function parseFillLength(value: unknown): number {
  return isInt(value, 1, MAX_FILL_LENGTH_DAYS) ? value : fail("invalid_fill_length");
}

/** "HH:MM" or "HH:MM:00" on a whole minute, returned as "HH:MM". */
export function parseReminderTime(value: unknown): string {
  if (typeof value !== "string") return fail("invalid_reminder_time");
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : fail("invalid_reminder_time");
}

export type CompartmentInput = { id: string | null; name: string };

/**
 * The compartments, in the order they should be in. An entry with an `id` keeps (and may rename or move)
 * that compartment; one without is new. Names are trimmed, 1 to 40 characters, and different from each
 * other ignoring case. More than the cap is {@link HEALTH_CAPS}.compartmentsPerPlan.
 */
export function parseCompartments(value: unknown): CompartmentInput[] {
  if (!Array.isArray(value) || value.length === 0) return fail("invalid_compartments");
  if (value.length > HEALTH_CAPS.compartmentsPerPlan.max) return fail("too_many_compartments");
  const out: CompartmentInput[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return fail("invalid_compartments");
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof name !== "string") return fail("invalid_compartment_name");
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_COMPARTMENT_NAME_LENGTH) return fail("invalid_compartment_name");
    const key = trimmed.toLowerCase();
    if (names.has(key)) return fail("duplicate_compartment_name");
    names.add(key);
    if (id !== undefined && id !== null) {
      if (!isUuid(id) || ids.has(id.toLowerCase())) return fail("compartment_not_found");
      ids.add(id.toLowerCase());
    }
    out.push({ id: typeof id === "string" ? id : null, name: trimmed });
  }
  return out;
}

/** Names for a new plan: the four defaults when none are given, otherwise the given ones. */
export function parseNewCompartmentNames(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_COMPARTMENT_NAMES];
  if (!Array.isArray(value)) return fail("invalid_compartments");
  return parseCompartments(value.map((name) => ({ name }))).map((c) => c.name);
}

/** `{ "08:00": "<compartment id>" }`: each dose time to the compartment its pills go in. */
export function parseTimeMap(value: unknown): Map<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("invalid_time_map");
  const out = new Map<string, string>();
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    let time: string;
    try {
      time = normalizeDoseTime(key);
    } catch {
      return fail("invalid_time_map");
    }
    if (out.has(time) || !isUuid(id)) return fail("invalid_time_map");
    out.set(time, id.toLowerCase());
  }
  return out;
}

/** The people reminded about fill appointments: distinct member ids, at most {@link MAX_CAREGIVERS}. */
export function parseCaregivers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CAREGIVERS) return fail("invalid_caregivers");
  const out = new Set<string>();
  for (const id of value) {
    if (!isUuid(id)) return fail("invalid_caregivers");
    out.add(id.toLowerCase());
  }
  return [...out];
}

/** `{ groupId, compartmentId }`: put every time a group runs into one compartment. */
export function parseGroupAssignment(value: unknown): { groupId: string; compartmentId: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("invalid_group_assignment");
  const { groupId, compartmentId } = value as { groupId?: unknown; compartmentId?: unknown };
  if (!isUuid(groupId) || !isUuid(compartmentId)) return fail("invalid_group_assignment");
  return { groupId: groupId.toLowerCase(), compartmentId: compartmentId.toLowerCase() };
}

/** The version the caller saw; required to change an existing plan. */
export function parseVersion(value: unknown): number {
  return isInt(value, 1, 2_000_000_000) ? value : fail("invalid_version");
}
