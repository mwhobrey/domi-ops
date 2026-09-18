import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { households } from "@domi-ops/db";
import { addDaysIso } from "@domi-ops/calendar-sync";
import { eq } from "drizzle-orm";
import { buildMedicationDoseOverlays } from "./calendar-overlays.js";
import { isHouseholdModuleEnabled } from "./household-modules.js";
import { listNativeCalendarEvents } from "./calendar-native-events.js";
import type { CalendarListEvent } from "./calendar-event-policy.js";
import {
  classifyConflict,
  intervalForCheckWindow,
  intervalForSpan,
  type CheckWindowInput,
} from "./schedule-conflict-math.js";

/** Query-range padding around the checked window so a same-day buffer never gets excluded by
 * the SQL fetch. The actual red/yellow decision always uses each row's true buffer values. */
const SCHEDULE_CONFLICT_QUERY_PAD_DAYS = 1;

/** For mode "at", an exact-instant match against dose times is almost always empty — widen the
 * meds lookup to a tolerance window so "what's due around now" reads as useful. Range checks
 * need no tolerance; they already use the literal checked window. */
const MED_DUE_POINT_TOLERANCE_MINUTES = 30;

export type ScheduleConflictEventDto = {
  event: CalendarListEvent;
  severity: "red" | "yellow";
  reason: "literal_overlap" | "event_buffer_encroachment" | "check_buffer_encroachment";
};

export type ScheduleConflictMedDto = {
  id: string;
  title: string;
  scheduledAt: string;
  deepLink: string;
};

export type ScheduleConflictResponse = {
  checkedWindow: {
    mode: "at" | "range";
    timeZone: string;
    startAt: string;
    endAt: string;
    adHocBuffer: { beforeMinutes: number; afterMinutes: number } | null;
  };
  conflicts: {
    red: ScheduleConflictEventDto[];
    yellow: ScheduleConflictEventDto[];
  };
  meds: ScheduleConflictMedDto[];
  summary: { redCount: number; yellowCount: number; medCount: number };
};

function checkWindowDateBounds(input: CheckWindowInput): { from: string; to: string } {
  if (input.mode === "at") return { from: input.date, to: input.date };
  const to = input.endDate ?? input.startDate;
  return input.startDate <= to ? { from: input.startDate, to } : { from: to, to: input.startDate };
}

export async function computeScheduleConflicts(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  input: CheckWindowInput,
  adHocBuffer: { beforeMinutes: number; afterMinutes: number } | null,
): Promise<ScheduleConflictResponse> {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const householdTimeZone = household?.timezone ?? "UTC";
  const resolvedTimeZone = input.timeZone || householdTimeZone;

  const checkInterval = intervalForCheckWindow(input, householdTimeZone);

  const { from, to } = checkWindowDateBounds(input);
  const paddedFrom = addDaysIso(from, -SCHEDULE_CONFLICT_QUERY_PAD_DAYS);
  const paddedTo = addDaysIso(to, SCHEDULE_CONFLICT_QUERY_PAD_DAYS);

  const nativeEvents = await listNativeCalendarEvents(db, auth, paddedFrom, paddedTo);

  const red: ScheduleConflictEventDto[] = [];
  const yellow: ScheduleConflictEventDto[] = [];
  for (const event of nativeEvents) {
    const eventInterval = intervalForSpan(
      {
        startDate: event.startDate,
        endDate: event.endDate,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        timeZone: event.timeZone,
      },
      householdTimeZone,
    );
    const classification = classifyConflict({
      checkInterval,
      checkBufferBeforeMinutes: adHocBuffer?.beforeMinutes,
      checkBufferAfterMinutes: adHocBuffer?.afterMinutes,
      eventInterval,
      eventBufferBeforeMinutes: event.driveBufferBeforeMinutes,
      eventBufferAfterMinutes: event.driveBufferAfterMinutes,
    });
    if (classification.severity === "red") {
      red.push({ event, severity: "red", reason: classification.reason });
    } else if (classification.severity === "yellow") {
      yellow.push({ event, severity: "yellow", reason: classification.reason });
    }
  }

  const meds: ScheduleConflictMedDto[] = [];
  const healthOn = await isHouseholdModuleEnabled(db, env, auth.householdId, "health");
  if (healthOn) {
    const medOverlays = await buildMedicationDoseOverlays(db, env, auth, paddedFrom, paddedTo);
    const toleranceMs =
      input.mode === "at" ? MED_DUE_POINT_TOLERANCE_MINUTES * 60_000 : 0;
    const medWindow = { start: checkInterval.start - toleranceMs, end: checkInterval.end + toleranceMs };
    for (const overlay of medOverlays) {
      if (!overlay.startTime) continue;
      const doseAt = intervalForSpan(
        {
          startDate: overlay.startDate,
          endDate: overlay.endDate,
          startTime: overlay.startTime,
          endTime: overlay.startTime,
          allDay: false,
          timeZone: overlay.timeZone,
        },
        householdTimeZone,
      ).start;
      if (doseAt < medWindow.start || doseAt > medWindow.end) continue;
      meds.push({
        id: overlay.id,
        title: overlay.title,
        scheduledAt: new Date(doseAt).toISOString(),
        deepLink: overlay.deepLink ?? "",
      });
    }
  }

  return {
    checkedWindow: {
      mode: input.mode,
      timeZone: resolvedTimeZone,
      startAt: new Date(checkInterval.start).toISOString(),
      endAt: new Date(checkInterval.end).toISOString(),
      adHocBuffer,
    },
    conflicts: { red, yellow },
    meds,
    summary: { redCount: red.length, yellowCount: yellow.length, medCount: meds.length },
  };
}
