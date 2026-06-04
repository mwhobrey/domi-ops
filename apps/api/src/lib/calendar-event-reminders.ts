import type { Database } from "@whome/db";
import { calendarEventReminders } from "@whome/db";
import { eq } from "drizzle-orm";

const ALLOWED_OFFSETS = new Set([15, 60, 1440]);

export function normalizeReminderOffsets(offsets: unknown): number[] {
  if (!Array.isArray(offsets)) return [];
  const out = new Set<number>();
  for (const n of offsets) {
    const v = Number(n);
    if (ALLOWED_OFFSETS.has(v)) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export async function replaceEventReminders(
  db: Database,
  eventId: string,
  householdId: string,
  offsets: number[],
): Promise<void> {
  await db.delete(calendarEventReminders).where(eq(calendarEventReminders.eventId, eventId));
  if (offsets.length === 0) return;
  await db.insert(calendarEventReminders).values(
    offsets.map((offsetMinutes) => ({
      eventId,
      householdId,
      offsetMinutes,
      enabled: true,
    })),
  );
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
