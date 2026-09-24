import type { Database } from "@domi-ops/db";
import { householdMembers } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import type { RepeatRuleInput } from "./calendar-repeat.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_EVENT_ATTENDEES = 20;

/** Trimmed location, null to clear, undefined when the field wasn't sent. */
export function normalizeEventLocation(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 512);
  return trimmed || null;
}

/** De-duplicated member ids, null to clear, undefined when not sent, "invalid" on bad input. */
export function normalizeAttendeeIds(value: unknown): string[] | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return "invalid";
  const ids = [...new Set(value)];
  if (ids.length > MAX_EVENT_ATTENDEES) return "invalid";
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) return "invalid";
  return ids.length > 0 ? (ids as string[]) : null;
}

export async function attendeesBelongToHousehold(
  db: Database,
  householdId: string,
  ids: string[] | null,
): Promise<boolean> {
  if (!ids || ids.length === 0) return true;
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, ids)));
  return rows.length === ids.length;
}

export type RepeatRuleBody = {
  freq: string;
  interval?: number;
  until?: string;
  count?: number;
};

/** Validates a create-time repeat rule; returns the normalized rule or an error code. */
export function parseRepeatRuleBody(
  body: RepeatRuleBody,
  startDate: string,
): { rule: RepeatRuleInput } | { error: string } {
  const freq = body.freq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") {
    return { error: "invalid_repeat_freq" };
  }
  const interval = body.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) {
    return { error: "invalid_repeat_interval" };
  }
  if (body.until != null && body.count != null) return { error: "repeat_until_or_count" };
  if (body.until != null && (!ISO_DATE.test(body.until) || body.until < startDate)) {
    return { error: "invalid_repeat_until" };
  }
  if (body.count != null && (!Number.isInteger(body.count) || body.count < 1 || body.count > 999)) {
    return { error: "invalid_repeat_count" };
  }
  return {
    rule: {
      freq,
      interval,
      until: body.until ?? undefined,
      count: body.count ?? undefined,
      startDate,
    },
  };
}

/** Whole days from `start` to `end` (0 when end is missing or earlier). */
export function spanDays(start: string, end: string | null | undefined): number {
  if (!end || end <= start) return 0;
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

const PATCHABLE_EVENT_FIELDS = [
  "title",
  "description",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "allDay",
  "categoryKey",
  "calendarId",
  "timeZone",
  "driveBufferBeforeMinutes",
  "driveBufferAfterMinutes",
] as const;

/** Copies only client-editable columns, so a PATCH body can't rewrite ids or sync state. */
export function pickEventPatch(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PATCHABLE_EVENT_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
