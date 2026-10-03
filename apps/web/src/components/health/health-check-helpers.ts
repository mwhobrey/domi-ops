import {
  formatExerciseSummary,
  formatFoodLogSummary,
  formatPainSummary,
  formatReadingsSummary,
} from "./health-helpers";
import type {
  CheckSlot,
  CheckSlotRow,
  CheckSlotStatus,
  HealthCheck,
  HealthCheckTemplate,
  HealthEvent,
} from "./health-types";

/** An unanswered slot: it can still be logged or skipped. */
export function isCheckSlotPending(status: CheckSlotStatus): boolean {
  return status === "upcoming" || status === "due" || status === "overdue";
}

/** Which log sheet a check opens. Types without a quick sheet use the full event editor. */
export type CheckLogSheet = "vitals" | "pain" | "meal" | "exercise" | "event";

export function checkLogSheet(check: Pick<HealthCheck, "eventType">): CheckLogSheet {
  switch (check.eventType) {
    case "vitals":
      return "vitals";
    case "pain":
      return "pain";
    case "food_intake":
      return "meal";
    case "exercise":
      return "exercise";
    default:
      return "event";
  }
}

/** What a log sheet needs to know when it is opened for a check's slot. */
export interface CheckLogContext {
  /** Shown above the form, e.g. "Ally BP · 12:05 PM". */
  heading: string;
  /** Vitals: the metrics to prompt for, in order. Empty / absent = the sheet's defaults. */
  metrics?: string[];
  /** Pain: regions to pre-select. */
  regions?: string[];
  /** Exercise: the activity to pre-fill. */
  activity?: string;
  /** Default title for the logged event. */
  title?: string;
}

export function buildCheckLogContext(
  check: Pick<HealthCheck, "name" | "template">,
  timeLabel: string,
): CheckLogContext {
  const t: HealthCheckTemplate = check.template ?? {};
  return {
    heading: `${check.name} · ${timeLabel}`,
    metrics: t.metrics && t.metrics.length > 0 ? t.metrics : undefined,
    regions: t.regions && t.regions.length > 0 ? t.regions : undefined,
    activity: t.activity || undefined,
    title: t.title || undefined,
  };
}

const STATUS_ORDER: Record<CheckSlotStatus, number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  missed: 3,
  skipped: 4,
  done: 5,
};

/**
 * The rows for one person's Today list, in clock order. A slot that is waiting for an answer sorts
 * by time like everything else; the status only breaks ties so equal times read the same each load.
 */
export function checkSlotRowsForMember(
  checks: readonly HealthCheck[],
  slotsByCheck: ReadonlyMap<string, readonly CheckSlot[]>,
  memberId: string,
): CheckSlotRow[] {
  const rows: CheckSlotRow[] = [];
  for (const check of checks) {
    if (check.memberId !== memberId || !check.enabled) continue;
    for (const slot of slotsByCheck.get(check.id) ?? []) rows.push({ check, slot });
  }
  return rows.sort(
    (a, b) =>
      a.slot.scheduledAt.localeCompare(b.slot.scheduledAt) ||
      STATUS_ORDER[a.slot.status] - STATUS_ORDER[b.slot.status] ||
      a.check.name.localeCompare(b.check.name) ||
      a.check.id.localeCompare(b.check.id),
  );
}

/** "2 of 4 done" style summary of a list of rows. */
export function summarizeCheckRows(rows: readonly CheckSlotRow[]): { done: number; total: number; overdue: number } {
  return {
    done: rows.filter((r) => r.slot.status === "done").length,
    total: rows.length,
    overdue: rows.filter((r) => r.slot.status === "overdue").length,
  };
}

export function checkSlotBadge(status: CheckSlotStatus): { label: string; tone: "success" | "warning" | "default" } {
  switch (status) {
    case "done":
      return { label: "Done", tone: "success" };
    case "skipped":
      return { label: "Skipped", tone: "default" };
    case "missed":
      return { label: "Missed", tone: "warning" };
    case "overdue":
      return { label: "Overdue", tone: "warning" };
    case "due":
      return { label: "Due now", tone: "warning" };
    default:
      return { label: "Upcoming", tone: "default" };
  }
}

/** The instant a notification link points at, to the minute, or null if it isn't a date. */
export function parseSlotInstant(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 60_000) * 60_000;
}

/** Find the row a `/health?check=…&scheduledAt=…` link is about. */
export function findDeepLinkedRow(
  rows: readonly CheckSlotRow[],
  checkId: string,
  scheduledAt: string | undefined,
): CheckSlotRow | undefined {
  const minute = parseSlotInstant(scheduledAt);
  const mine = rows.filter((r) => r.check.id === checkId);
  if (minute != null) {
    return mine.find((r) => parseSlotInstant(r.slot.scheduledAt) === minute);
  }
  // No time in the link: the next thing waiting on this check.
  return mine.find((r) => isCheckSlotPending(r.slot.status));
}

/** "BP 128/82 · HR 72" style values for a done row, from the entry that completed it. */
export function checkRowValues(event: HealthEvent | undefined): string | null {
  if (!event) return null;
  switch (event.type) {
    case "vitals":
      return formatReadingsSummary(event.readings);
    case "exercise":
      return formatExerciseSummary(event.exerciseDetails);
    case "pain":
      return formatPainSummary(event.painLogs);
    case "food_intake":
      return formatFoodLogSummary(event.foodLogEntries);
    default:
      return event.title || null;
  }
}

/**
 * The local days to ask the API about when a notification points at a slot. The slot's day in the
 * viewer's zone is within a day of its UTC date whatever the zone, so a day either side always
 * contains it.
 */
export function slotLookupRange(
  scheduledAt: string | undefined,
  now: Date = new Date(),
): { from: string; to: string } {
  const base = parseSlotInstant(scheduledAt) ?? now.getTime();
  const day = (offset: number) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-1), to: day(1) };
}

/** Keys (`checkId|minute`) of the checks of a group at the time a group notification is for. */
export function groupHighlightKeys(checkIds: readonly string[], scheduledAt: string | undefined): Set<string> {
  const minute = parseSlotInstant(scheduledAt);
  if (minute == null) return new Set();
  return new Set(checkIds.map((id) => `${id}|${minute / 60_000}`));
}
