import type { Database } from "@whome/db";
import { calendarEventReminders } from "@whome/db";
import { eq } from "drizzle-orm";

/** Preset offsets shown in the calendar event sheet (minutes before start). */
export const REMINDER_PRESET_OFFSETS = [
  5, 10, 15, 30, 60, 120, 180, 1440, 2880, 10080,
] as const;

export const MAX_REMINDER_OFFSET_MINUTES = 10080; // 1 week

const PRESET_SET = new Set<number>(REMINDER_PRESET_OFFSETS);

export function normalizeReminderOffsets(offsets: unknown): number[] {
  if (!Array.isArray(offsets)) return [];
  const out = new Set<number>();
  for (const n of offsets) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v < 1 || v > MAX_REMINDER_OFFSET_MINUTES) continue;
    out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export function snapGoogleReminderMinutes(minutes: number): number | null {
  const rounded = Math.round(minutes);
  if (!Number.isFinite(rounded) || rounded < 1 || rounded > MAX_REMINDER_OFFSET_MINUTES) {
    return null;
  }
  if (PRESET_SET.has(rounded)) return rounded;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const allowed of REMINDER_PRESET_OFFSETS) {
    const dist = Math.abs(allowed - rounded);
    if (dist < bestDist) {
      bestDist = dist;
      best = allowed;
    }
  }
  return best;
}

export function offsetsFromGoogleEvent(event: Record<string, unknown>): number[] {
  const rem = event.reminders as
    | { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] }
    | undefined;
  if (!rem || rem.useDefault) return [];
  const out = new Set<number>();
  for (const o of rem.overrides ?? []) {
    const method = String(o.method ?? "popup");
    if (method !== "popup" && method !== "email") continue;
    const snapped = snapGoogleReminderMinutes(Number(o.minutes));
    if (snapped != null) out.add(snapped);
  }
  return normalizeReminderOffsets([...out]);
}

export function googleRemindersBody(offsets: number[]): Record<string, unknown> | undefined {
  const normalized = normalizeReminderOffsets(offsets);
  if (normalized.length === 0) return undefined;
  return {
    useDefault: false,
    overrides: normalized.map((minutes) => ({ method: "popup", minutes })),
  };
}

export function parseRuleReminderOffsets(
  value: number[] | string | null | undefined,
): number[] {
  if (value == null) return [];
  if (Array.isArray(value)) return normalizeReminderOffsets(value);
  try {
    return normalizeReminderOffsets(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export async function listReminderOffsetsForEvent(
  db: Database,
  eventId: string,
): Promise<number[]> {
  const rows = await db
    .select({ offsetMinutes: calendarEventReminders.offsetMinutes })
    .from(calendarEventReminders)
    .where(eq(calendarEventReminders.eventId, eventId));
  return rows.map((r) => r.offsetMinutes);
}

export async function replaceEventReminders(
  db: Database,
  eventId: string,
  householdId: string,
  offsets: number[],
): Promise<void> {
  await db.delete(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId));
  const normalized = normalizeReminderOffsets(offsets);
  if (normalized.length === 0) return;
  await db.insert(calendarEventReminders).values(
    normalized.map((offsetMinutes) => ({
      eventId,
      householdId,
      offsetMinutes,
      enabled: true,
    })),
  );
}

/** Human label for preset offsets in UI. */
export function reminderOffsetLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return h === 1 ? "1 hour before" : `${h} hours before`;
  }
  const d = minutes / 1440;
  return d === 1 ? "1 day before" : `${d} days before`;
}
