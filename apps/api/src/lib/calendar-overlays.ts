import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthMedications,
  households,
  schoolAssignments,
  schoolClasses,
  users,
} from "@domi-ops/db";
import {
  localDateOfInstant,
  localHourInTz,
  todayIsoDateInTz,
  zonedLocalToUtc,
} from "@domi-ops/calendar-sync";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { CalendarListEvent, CalendarOverlayKind } from "./calendar-event-policy.js";
import { parseMedSchedule } from "./health-serialize.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import {
  healthEventVisibleWhere,
  healthMedicationVisibleWhere,
} from "./health-access.js";
import { memberEnrollmentsForHousehold } from "./school-auth-context.js";
import { visibleClassIdsForMember } from "./school-access.js";
import { publishedAssignmentVisibilities } from "./school-assignment-visibility.js";

export const OVERLAY_CALENDAR_SCHOOL = "__overlay_school__";
export const OVERLAY_CALENDAR_HEALTH_EVENT = "__overlay_health_event__";
export const OVERLAY_CALENDAR_HEALTH_MED = "__overlay_health_med__";

export const OVERLAY_COLOR_SCHOOL = "#d97706";
export const OVERLAY_COLOR_HEALTH_EVENT = "#e11d48";
export const OVERLAY_COLOR_HEALTH_MED = "#0d9488";

export type CalendarOverlayPrefs = {
  school: boolean;
  healthEvents: boolean;
  healthMeds: boolean;
};

export type OverlayModules = {
  school: boolean;
  health: boolean;
};

function localTimeString(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(instant);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const hour = String(Number(get("hour")) % 24).padStart(2, "0");
    return `${hour}:${get("minute")}:${get("second")}`;
  } catch {
    return instant.toISOString().slice(11, 19);
  }
}

function isMidnightLocal(instant: Date, timeZone: string): boolean {
  return localHourInTz(instant, timeZone) === 0;
}

function overlayEvent(params: {
  id: string;
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  color: string;
  calendarId: string;
  source: CalendarListEvent["source"];
  overlayKind: CalendarOverlayKind;
  deepLink: string;
}): CalendarListEvent {
  return {
    id: params.id,
    title: params.title,
    description: null,
    startDate: params.startDate,
    endDate: params.endDate ?? null,
    startTime: params.startTime,
    endTime: params.endTime,
    allDay: params.allDay,
    color: params.color,
    categoryKey: null,
    categoryLabel: null,
    timeZone: null,
    calendarId: params.calendarId,
    source: params.source,
    overlayKind: params.overlayKind,
    deepLink: params.deepLink,
    editable: false,
    pushable: false,
    syncStatus: "synced",
    recurringRuleId: null,
    reminderOffsets: [],
  };
}

export async function buildSchoolAssignmentOverlays(
  db: Database,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  from: string,
  to: string,
): Promise<CalendarListEvent[]> {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timeZone = household?.timezone ?? "UTC";

  const classRows = await db
    .select({
      id: schoolClasses.id,
      teacherMemberId: schoolClasses.teacherMemberId,
      archived: schoolClasses.archived,
    })
    .from(schoolClasses)
    .where(eq(schoolClasses.householdId, auth.householdId));

  const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, auth.memberId);
  const visibleIds = visibleClassIdsForMember({
    memberId: auth.memberId,
    householdRole: auth.role,
    classes: classRows.map((r) => ({
      id: r.id,
      teacherMemberId: r.teacherMemberId,
      archived: r.archived ?? false,
    })),
    enrollments,
  });

  if (visibleIds.length === 0) return [];

  const rangeStart = zonedLocalToUtc(from, "00:00", timeZone);
  const rangeEnd = zonedLocalToUtc(to, "23:59", timeZone);

  const rows = await db
    .select({
      id: schoolAssignments.id,
      title: schoolAssignments.title,
      dueAt: schoolAssignments.dueAt,
      className: schoolClasses.name,
    })
    .from(schoolAssignments)
    .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
    .where(
      and(
        eq(schoolClasses.householdId, auth.householdId),
        inArray(schoolClasses.id, visibleIds),
        inArray(schoolAssignments.visibility, publishedAssignmentVisibilities()),
        isNotNull(schoolAssignments.dueAt),
        gte(schoolAssignments.dueAt, rangeStart),
        lte(schoolAssignments.dueAt, rangeEnd),
      ),
    );

  const overlays: CalendarListEvent[] = [];
  for (const row of rows) {
    const due = row.dueAt!;
    const startDate = localDateOfInstant(due, timeZone);
    if (startDate < from || startDate > to) continue;
    const allDay = isMidnightLocal(due, timeZone);
    overlays.push(
      overlayEvent({
        id: `overlay:school:${row.id}`,
        title: `${row.className}: ${row.title}`,
        startDate,
        endDate: allDay ? startDate : null,
        startTime: allDay ? null : localTimeString(due, timeZone),
        endTime: null,
        allDay,
        color: OVERLAY_COLOR_SCHOOL,
        calendarId: OVERLAY_CALENDAR_SCHOOL,
        source: "school",
        overlayKind: "school",
        deepLink: `/school/assignment/${row.id}`,
      }),
    );
  }
  return overlays;
}

export async function buildHealthEventOverlays(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  from: string,
  to: string,
): Promise<CalendarListEvent[]> {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timeZone = household?.timezone ?? "UTC";

  const rows = await db
    .select()
    .from(healthEvents)
    .where(healthEventVisibleWhere(db, auth));

  const overlays: CalendarListEvent[] = [];
  const today = todayIsoDateInTz(timeZone);
  for (const row of rows) {
    const anchor = row.startedAt ?? row.endedAt ?? row.createdAt;
    if (!anchor) continue;
    const durationKind = row.durationKind ?? "single_day";
    const startDate = localDateOfInstant(anchor, timeZone);
    let spanEndDate: string;
    if (durationKind === "ongoing") {
      spanEndDate = row.endedAt
        ? localDateOfInstant(row.endedAt, timeZone)
        : to > today
          ? to
          : today;
    } else {
      spanEndDate = startDate;
    }

    if (spanEndDate < from || startDate > to) continue;

    const title = decryptHealthFieldOrPassthrough(row.title, env) ?? "Health event";
    const isOngoingOpen = durationKind === "ongoing" && !row.endedAt;
    const allDay =
      durationKind === "ongoing" ||
      !row.startedAt ||
      isMidnightLocal(row.startedAt, timeZone);
    const multiDay = spanEndDate !== startDate;
    overlays.push(
      overlayEvent({
        id: `overlay:health:event:${row.id}`,
        title: isOngoingOpen ? `${title} (ongoing)` : title,
        startDate,
        endDate: multiDay ? spanEndDate : allDay ? startDate : null,
        startTime: allDay || !row.startedAt ? null : localTimeString(row.startedAt, timeZone),
        endTime: null,
        allDay,
        color: OVERLAY_COLOR_HEALTH_EVENT,
        calendarId: OVERLAY_CALENDAR_HEALTH_EVENT,
        source: "health_event",
        overlayKind: "health_event",
        deepLink: `/health?event=${row.id}`,
      }),
    );
  }
  return overlays;
}

function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 400) {
    out.push(cur);
    const d = new Date(`${cur}T12:00:00`);
    d.setDate(d.getDate() + 1);
    cur = d.toISOString().slice(0, 10);
    guard += 1;
  }
  return out;
}

export async function buildMedicationDoseOverlays(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  from: string,
  to: string,
): Promise<CalendarListEvent[]> {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timeZone = household?.timezone ?? "UTC";

  const meds = await db
    .select()
    .from(healthMedications)
    .where(
      and(
        healthMedicationVisibleWhere(db, auth),
        eq(healthMedications.enabled, true),
        eq(healthMedications.scheduleKind, "scheduled"),
      ),
    );

  const overlays: CalendarListEvent[] = [];
  for (const med of meds) {
    const schedule = parseMedSchedule(med.scheduleJson);
    const times = schedule.times ?? [];
    if (times.length === 0) continue;

    const name = decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication";

    for (const date of datesInRange(from, to)) {
      if (med.startDate && date < med.startDate) continue;
      if (med.endDate && date > med.endDate) continue;
      if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
        const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
        if (!schedule.daysOfWeek.includes(dow)) continue;
      }
      for (const time of times) {
        const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
        const scheduledAt = zonedLocalToUtc(date, hhmm, timeZone);
        const iso = scheduledAt.toISOString();
        overlays.push(
          overlayEvent({
            id: `overlay:health:med:${med.id}:${iso}`,
            title: name,
            startDate: date,
            startTime: `${hhmm}:00`,
            endTime: null,
            allDay: false,
            color: OVERLAY_COLOR_HEALTH_MED,
            calendarId: OVERLAY_CALENDAR_HEALTH_MED,
            source: "health_med",
            overlayKind: "health_med",
            deepLink: `/health?medication=${med.id}`,
          }),
        );
      }
    }
  }
  return overlays;
}

export async function loadCalendarOverlayPrefs(
  db: Database,
  userId: string,
): Promise<CalendarOverlayPrefs> {
  const [row] = await db
    .select({
      school: users.calendarOverlaySchoolEnabled,
      healthEvents: users.calendarOverlayHealthEventsEnabled,
      healthMeds: users.calendarOverlayHealthMedsEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    school: row?.school ?? true,
    healthEvents: row?.healthEvents ?? true,
    healthMeds: row?.healthMeds ?? true,
  };
}

export function mergeCalendarEvents(
  native: CalendarListEvent[],
  overlays: CalendarListEvent[],
): CalendarListEvent[] {
  return [...native, ...overlays].sort((a, b) => {
    const dateCmp = a.startDate.localeCompare(b.startDate);
    if (dateCmp !== 0) return dateCmp;
    const ta = a.startTime ?? "";
    const tb = b.startTime ?? "";
    return ta.localeCompare(tb);
  });
}

export async function buildAllCalendarOverlays(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  from: string,
  to: string,
  modules: OverlayModules,
  prefs: CalendarOverlayPrefs,
): Promise<CalendarListEvent[]> {
  const overlays: CalendarListEvent[] = [];
  if (modules.school && prefs.school) {
    overlays.push(...(await buildSchoolAssignmentOverlays(db, auth, from, to)));
  }
  if (modules.health && prefs.healthEvents) {
    overlays.push(...(await buildHealthEventOverlays(db, env, auth, from, to)));
  }
  if (modules.health && prefs.healthMeds) {
    overlays.push(...(await buildMedicationDoseOverlays(db, env, auth, from, to)));
  }
  return overlays;
}
