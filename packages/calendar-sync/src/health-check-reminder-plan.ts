import { CHECK_SLOT_TOLERANCE_MINUTES, type SlotResult } from "./health-check-slots.js";
import { LOOKBACK_MS, WINDOW_MS, reminderWhenLabel } from "./health-reminder-shared.js";
import { formatTimeLabelInTz } from "./household-time.js";

/** What to remind about for a slot, and how it reads. Split out so the group reminders share it. */

/**
 * A slot that is still unanswered this long after it was due gets one gentle nudge. It is the same
 * 30 minutes as the matching tolerance, i.e. the moment the slot turns `overdue`. The nudge is
 * stored in the dedupe table with a negative offset, which a person-chosen offset (always >= 0)
 * can never collide with.
 */
export const OVERDUE_NUDGE_AFTER_MINUTES = CHECK_SLOT_TOLERANCE_MINUTES;
const OVERDUE_NUDGE_OFFSET = -OVERDUE_NUDGE_AFTER_MINUTES;

export type CheckReminderKind = "upcoming" | "due" | "overdue";

/**
 * Which reminders are due for one slot right now. Pure.
 *
 * - `upcoming` / `due` slots: one reminder per configured offset (minutes before the slot) whose
 *   fire time falls inside the scan's window, so a scan that ran late still sends it.
 * - an `overdue` slot: the single nudge, if its fire time is inside the window.
 * - anything answered (`done`, `skipped`, `missed`): nothing.
 */
export function planCheckReminders(input: {
  slot: Pick<SlotResult, "scheduledAt" | "status">;
  offsets: readonly number[];
  now: Date;
}): { offsetMinutes: number; kind: CheckReminderKind }[] {
  const nowMs = input.now.getTime();
  const windowEnd = nowMs + WINDOW_MS;
  const lookbackStart = nowMs - LOOKBACK_MS;
  const slotMs = input.slot.scheduledAt.getTime();
  const inWindow = (fireAt: number) => fireAt <= windowEnd && fireAt >= lookbackStart;

  if (input.slot.status === "upcoming" || input.slot.status === "due") {
    const minutesUntil = Math.max(0, Math.round((slotMs - nowMs) / 60_000));
    const kind: CheckReminderKind = minutesUntil <= 0 ? "due" : "upcoming";
    return [...new Set(input.offsets)]
      .filter((offset) => inWindow(slotMs - offset * 60_000))
      .map((offsetMinutes) => ({ offsetMinutes, kind }));
  }

  if (input.slot.status === "overdue" && inWindow(slotMs + OVERDUE_NUDGE_AFTER_MINUTES * 60_000)) {
    return [{ offsetMinutes: OVERDUE_NUDGE_OFFSET, kind: "overdue" }];
  }
  return [];
}

export function buildCheckReminderCopy(input: {
  checkName: string;
  kind: CheckReminderKind;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): { title: string; body: string } {
  const timeLabel = formatTimeLabelInTz(input.scheduledAt, input.timeZone);
  const when = reminderWhenLabel(input.scheduledAt, input.timeZone, input.now);
  const core =
    input.kind === "overdue"
      ? `${input.checkName} at ${when} hasn't been logged yet`
      : input.kind === "due"
        ? `Time to check ${input.checkName} at ${when}`
        : `${input.checkName} at ${when}`;
  return {
    title: input.kind === "overdue" ? `Health check overdue • ${timeLabel}` : `Health check • ${timeLabel}`,
    // The notification title carries only the time; the body has the full context. A caregiver is
    // told whose check it is.
    body: input.isSubject ? core : `${input.subjectLabel} — ${core}`,
  };
}
