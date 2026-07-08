import type { Database } from "@domi-ops/db";
import type { CalendarEventRow } from "./calendar-event-policy.js";
import {
  type CalendarEventDto,
  type EventPolicy,
  toEventDto,
} from "./calendar-event-policy.js";
import { categoryCompositeKey, categoryLabelMap } from "./calendar-event-categories.js";
import { listReminderOffsetsForEvent } from "./calendar-event-reminders.js";

export type EnrichedEventDto = CalendarEventDto & {
  categoryLabel: string | null;
  reminderOffsets: number[];
};

export async function enrichEventDto(
  db: Database,
  householdId: string,
  row: CalendarEventRow,
  policy: EventPolicy,
): Promise<EnrichedEventDto> {
  const base = toEventDto(row, policy);
  const labels = await categoryLabelMap(db, householdId);
  const reminderOffsets = await listReminderOffsetsForEvent(db, row.id);
  return {
    ...base,
    categoryLabel: row.categoryKey
      ? (labels.get(categoryCompositeKey(row.calendarId, row.categoryKey)) ?? row.categoryKey)
      : null,
    reminderOffsets,
  };
}
