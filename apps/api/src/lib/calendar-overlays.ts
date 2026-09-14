import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthMedicationGroups,
  healthMedications,
  households,
  schoolAssignments,
  schoolClasses,
  users,
} from "@domi-ops/db";
import {
  localDateOfInstant,
  localHourInTz,
  nextIntervalPending,
  parseIntervalSchedule,
  todayIsoDateInTz,
  zonedLocalToUtc,
} from "@domi-ops/calendar-sync";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { CalendarListEvent, CalendarOverlayKind } from "./calendar-event-policy.js";
import { parseMedSchedule } from "./health-serialize.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import {
  healthEventVisibleWhere,
  healthMedicationGroupVisibleWhere,
  healthMedicationVisibleWhere,
  loadGroupMemberMedicationIdsMap,
  loadHealthMedicationGroupMembershipMap,
} from "./health-access.js";
import {
  GLANCE_DOSE_LOG_LOOKBACK_DAYS,
  isInstantLogged,
  loadDoseLogMap,
  type DoseLogEntry,
} from "./health-med-logging.js";
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

function medHasScheduledTime(scheduleJson: string | null, hhmm: string): boolean {
  return (parseMedSchedule(scheduleJson).times ?? []).some((t) => t.slice(0, 5) === hhmm);
}

function toIntervalLogs(entries: DoseLogEntry[]) {
  return entries.map((l) => ({
    scheduledAt: l.scheduledAt,
    loggedAt: l.loggedAt,
    status: l.status,
  }));
}

function medOverlay(params: {
  id: string;
  title: string;
  date: string;
  hhmm: string;
  deepLink: string;
}): CalendarListEvent {
  return overlayEvent({
    id: params.id,
    title: params.title,
    startDate: params.date,
    startTime: `${params.hhmm}:00`,
    endTime: null,
    allDay: false,
    color: OVERLAY_COLOR_HEALTH_MED,
    calendarId: OVERLAY_CALENDAR_HEALTH_MED,
    source: "health_med",
    overlayKind: "health_med",
    deepLink: params.deepLink,
  });
}

/**
 * Medication dose overlays for calendar views.
 * - Prefer **groups** over member meds (claimed times / interval membership stay off the grid).
 * - Hide doses already logged (taken/skipped/missed); keep past untaken doses visible.
 */
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
  const today = todayIsoDateInTz(timeZone);
  const now = new Date();

  const [meds, groupRows] = await Promise.all([
    db
      .select()
      .from(healthMedications)
      .where(
        and(
          healthMedicationVisibleWhere(db, auth),
          eq(healthMedications.enabled, true),
        ),
      ),
    db
      .select()
      .from(healthMedicationGroups)
      .where(
        and(
          healthMedicationGroupVisibleWhere(db, auth),
          eq(healthMedicationGroups.enabled, true),
        ),
      ),
  ]);

  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const medGroupMembershipMap = await loadHealthMedicationGroupMembershipMap(
    db,
    meds.map((m) => m.id),
  );

  const groupMemberMedsMap = new Map<string, (typeof healthMedications.$inferSelect)[]>();
  if (groupRows.length > 0) {
    const [groupMemberIdsMap, allHouseholdMeds] = await Promise.all([
      loadGroupMemberMedicationIdsMap(
        db,
        groupRows.map((g) => g.id),
      ),
      db
        .select()
        .from(healthMedications)
        .where(
          and(eq(healthMedications.householdId, auth.householdId), eq(healthMedications.enabled, true)),
        ),
    ]);
    const medsById = new Map(allHouseholdMeds.map((m) => [m.id, m]));
    for (const [groupId, medicationIds] of groupMemberIdsMap) {
      groupMemberMedsMap.set(
        groupId,
        medicationIds.map((id) => medsById.get(id)).filter((m) => m !== undefined),
      );
    }
  }

  const doseMedIds = [
    ...new Set([...meds.map((m) => m.id), ...[...groupMemberMedsMap.values()].flat().map((m) => m.id)]),
  ];
  const lookbackStart = new Date(
    zonedLocalToUtc(from, "00:00", timeZone).getTime() -
      GLANCE_DOSE_LOG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const doseLogMap = await loadDoseLogMap(db, doseMedIds, lookbackStart);

  function scheduledTimesClaimedByGroups(medId: string): Set<string> {
    const claimed = new Set<string>();
    for (const groupId of medGroupMembershipMap.get(medId) ?? []) {
      const group = groupById.get(groupId);
      if (!group || group.scheduleKind !== "scheduled") continue;
      for (const t of parseMedSchedule(group.scheduleJson).times ?? []) {
        claimed.add(t.slice(0, 5));
      }
    }
    return claimed;
  }

  function isDelegatedToIntervalGroup(medId: string): boolean {
    return (medGroupMembershipMap.get(medId) ?? []).some(
      (groupId) => groupById.get(groupId)?.scheduleKind === "interval",
    );
  }

  const overlays: CalendarListEvent[] = [];
  const dates = datesInRange(from, to);

  for (const group of groupRows) {
    const members = groupMemberMedsMap.get(group.id) ?? [];
    if (members.length === 0) continue;
    const name = decryptHealthFieldOrPassthrough(group.name, env) ?? "Medications";

    if (group.scheduleKind === "scheduled") {
      const schedule = parseMedSchedule(group.scheduleJson);
      const times = schedule.times ?? [];
      for (const date of dates) {
        if (group.startDate && date < group.startDate) continue;
        if (group.endDate && date > group.endDate) continue;
        if (schedule.daysOfWeek?.length) {
          const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
          if (!schedule.daysOfWeek.includes(dow)) continue;
        }
        for (const time of times) {
          const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
          const scheduledAt = zonedLocalToUtc(date, hhmm, timeZone);
          const membersAtThisTime = members.filter((m) =>
            m.scheduleKind === "scheduled" ? medHasScheduledTime(m.scheduleJson, hhmm) : true,
          );
          if (membersAtThisTime.length === 0) continue;
          const allLogged = membersAtThisTime.every((m) =>
            isInstantLogged(doseLogMap, m.id, scheduledAt),
          );
          if (allLogged) continue;
          const iso = scheduledAt.toISOString();
          overlays.push(
            medOverlay({
              id: `overlay:health:medgroup:${group.id}:${iso}`,
              title: name,
              date,
              hhmm,
              deepLink: `/health?takeGroup=${encodeURIComponent(group.id)}&scheduledAt=${encodeURIComponent(iso)}`,
            }),
          );
        }
      }
      continue;
    }

    if (group.scheduleKind === "interval") {
      const interval = parseIntervalSchedule(group.scheduleJson);
      if (!interval) continue;
      const memberIds = members.map((m) => m.id);
      const logs = memberIds.flatMap((id) => toIntervalLogs(doseLogMap.get(id) ?? []));
      for (const date of dates) {
        if (group.startDate && date < group.startDate) continue;
        if (group.endDate && date > group.endDate) continue;
        const pending = nextIntervalPending({
          schedule: interval,
          tz: timeZone,
          date,
          now: date === today ? now : zonedLocalToUtc(date, "12:00", timeZone),
          logs,
        });
        if (!pending) continue;
        if (pending.awaitingFirst && date !== today) continue;
        const allLogged =
          !pending.awaitingFirst &&
          memberIds.every((id) => isInstantLogged(doseLogMap, id, pending.scheduledAt));
        if (allLogged) continue;
        const hhmm = pending.scheduledTime.slice(0, 5);
        const iso = pending.scheduledAt.toISOString();
        overlays.push(
          medOverlay({
            id: `overlay:health:medgroup:${group.id}:${iso}`,
            title: pending.awaitingFirst ? `${name} (start)` : name,
            date,
            hhmm,
            deepLink: `/health?takeGroup=${encodeURIComponent(group.id)}&scheduledAt=${encodeURIComponent(iso)}`,
          }),
        );
      }
    }
  }

  for (const med of meds) {
    if (med.scheduleKind === "prn") continue;
    if (med.scheduleKind === "interval" && isDelegatedToIntervalGroup(med.id)) continue;

    const name = decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication";

    if (med.scheduleKind === "scheduled") {
      const schedule = parseMedSchedule(med.scheduleJson);
      const times = schedule.times ?? [];
      if (times.length === 0) continue;
      const claimed = scheduledTimesClaimedByGroups(med.id);
      for (const date of dates) {
        if (med.startDate && date < med.startDate) continue;
        if (med.endDate && date > med.endDate) continue;
        if (schedule.daysOfWeek?.length) {
          const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
          if (!schedule.daysOfWeek.includes(dow)) continue;
        }
        for (const time of times) {
          const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
          if (claimed.has(hhmm)) continue;
          const scheduledAt = zonedLocalToUtc(date, hhmm, timeZone);
          if (isInstantLogged(doseLogMap, med.id, scheduledAt)) continue;
          const iso = scheduledAt.toISOString();
          overlays.push(
            medOverlay({
              id: `overlay:health:med:${med.id}:${iso}`,
              title: name,
              date,
              hhmm,
              deepLink: `/health?take=${encodeURIComponent(med.id)}&scheduledAt=${encodeURIComponent(iso)}`,
            }),
          );
        }
      }
      continue;
    }

    if (med.scheduleKind === "interval") {
      const interval = parseIntervalSchedule(med.scheduleJson);
      if (!interval) continue;
      const logs = toIntervalLogs(doseLogMap.get(med.id) ?? []);
      for (const date of dates) {
        if (med.startDate && date < med.startDate) continue;
        if (med.endDate && date > med.endDate) continue;
        const pending = nextIntervalPending({
          schedule: interval,
          tz: timeZone,
          date,
          now: date === today ? now : zonedLocalToUtc(date, "12:00", timeZone),
          logs,
        });
        if (!pending) continue;
        if (pending.awaitingFirst && date !== today) continue;
        if (!pending.awaitingFirst && isInstantLogged(doseLogMap, med.id, pending.scheduledAt)) {
          continue;
        }
        const hhmm = pending.scheduledTime.slice(0, 5);
        const iso = pending.scheduledAt.toISOString();
        overlays.push(
          medOverlay({
            id: `overlay:health:med:${med.id}:${iso}`,
            title: pending.awaitingFirst ? `${name} (start)` : name,
            date,
            hhmm,
            deepLink: `/health?take=${encodeURIComponent(med.id)}&scheduledAt=${encodeURIComponent(iso)}`,
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
