import type { Database } from "@whome/db";
import {
  calendarConnections,
  calendarEvents,
  linkedGoogleCalendars,
} from "@whome/db";
import { eq } from "drizzle-orm";

export type CalendarEventRow = typeof calendarEvents.$inferSelect;

export type LinkedTargetMeta = {
  connectionId: string;
  linkedCalendarId: string;
  syncMode: "import_only" | "manual" | "bidirectional";
  connectionUserId: string;
};

export type EventPolicyContext = {
  userId: string;
  linkedByTargetCalendar: Map<string, LinkedTargetMeta>;
};

export type EventPolicy = {
  editable: boolean;
  pushable: boolean;
  linkedCalendarId?: string;
  connectionId?: string;
};

export async function loadEventPolicyContext(
  db: Database,
  householdId: string,
  userId: string,
): Promise<EventPolicyContext> {
  const rows = await db
    .select({
      targetCalendarId: linkedGoogleCalendars.targetCalendarId,
      linkedCalendarId: linkedGoogleCalendars.id,
      connectionId: calendarConnections.id,
      syncMode: calendarConnections.syncMode,
      connectionUserId: calendarConnections.userId,
    })
    .from(linkedGoogleCalendars)
    .innerJoin(
      calendarConnections,
      eq(linkedGoogleCalendars.connectionId, calendarConnections.id),
    )
    .where(eq(calendarConnections.householdId, householdId));

  const linkedByTargetCalendar = new Map<string, LinkedTargetMeta>();
  for (const row of rows) {
    if (!row.targetCalendarId) continue;
    linkedByTargetCalendar.set(row.targetCalendarId, {
      connectionId: row.connectionId,
      linkedCalendarId: row.linkedCalendarId,
      syncMode: row.syncMode,
      connectionUserId: row.connectionUserId,
    });
  }
  return { userId, linkedByTargetCalendar };
}

export function computeEventPolicy(
  row: Pick<
    CalendarEventRow,
    "source" | "syncStatus" | "googleEventId" | "calendarId"
  >,
  ctx: EventPolicyContext,
): EventPolicy {
  if (row.syncStatus === "conflict") {
    return { editable: false, pushable: false };
  }
  if (row.source === "local" || !row.googleEventId) {
    return { editable: true, pushable: false };
  }
  const link = ctx.linkedByTargetCalendar.get(row.calendarId);
  const pushable = Boolean(
    link &&
      link.syncMode === "bidirectional" &&
      link.connectionUserId === ctx.userId &&
      row.googleEventId,
  );
  return {
    editable: true,
    pushable,
    linkedCalendarId: link?.linkedCalendarId,
    connectionId: link?.connectionId,
  };
}

export type CalendarEventDto = {
  id: string;
  householdId: string;
  calendarId: string;
  title: string;
  description: string | null;
  categoryKey: string | null;
  color: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone: string | null;
  allDay: boolean;
  source: "local" | "google";
  syncStatus: "synced" | "pending" | "conflict" | "error";
  googleEventId: string | null;
  googleRecurringEventId: string | null;
  recurringRuleId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  editable: boolean;
  pushable: boolean;
};

export function toEventDto(row: CalendarEventRow, policy: EventPolicy): CalendarEventDto {
  return {
    id: row.id,
    householdId: row.householdId,
    calendarId: row.calendarId,
    title: row.title,
    description: row.description,
    categoryKey: row.categoryKey,
    color: row.color,
    startDate: row.startDate,
    endDate: row.endDate,
    startTime: row.startTime,
    endTime: row.endTime,
    timeZone: row.timeZone,
    allDay: row.allDay,
    source: row.source,
    syncStatus: row.syncStatus,
    googleEventId: row.googleEventId,
    googleRecurringEventId: row.googleRecurringEventId,
    recurringRuleId: row.recurringRuleId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    editable: policy.editable,
    pushable: policy.pushable,
  };
}

const SCHEDULE_KEYS = [
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "allDay",
] as const;

export function isSchedulePatch(
  body: Record<string, unknown>,
  row: CalendarEventRow,
): boolean {
  for (const key of SCHEDULE_KEYS) {
    if (body[key] === undefined) continue;
    const next = body[key];
    const cur = row[key as keyof CalendarEventRow];
    if (String(next ?? "") !== String(cur ?? "")) return true;
  }
  return false;
}
