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
  HealthCheckGroup,
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

/**
 * Which scheduled slots each entry answers, as "Ally BP · 12:00 PM" labels keyed by entry id, so the
 * Log tab can say that an ad-hoc reading counted for a check. Only slots in `slotsByCheck` are known.
 */
export function slotCountsByEvent(
  checks: readonly HealthCheck[],
  slotsByCheck: ReadonlyMap<string, readonly CheckSlot[]>,
  formatTime: (iso: string) => string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of checks) {
    for (const s of slotsByCheck.get(c.id) ?? []) {
      if (!s.eventId) continue;
      const labels = out.get(s.eventId) ?? [];
      labels.push(`${c.name} · ${formatTime(s.scheduledAt)}`);
      out.set(s.eventId, labels);
    }
  }
  return out;
}

/** The entry that answered a done slot, if the viewer can edit it (a skipped or waiting slot has none). */
export function slotEditableEvent(row: CheckSlotRow, events: readonly HealthEvent[]): HealthEvent | undefined {
  if (isCheckSlotPending(row.slot.status) || !row.slot.eventId) return undefined;
  const event = events.find((e) => e.id === row.slot.eventId);
  return event && event.canEdit !== false ? event : undefined;
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

// ---------------------------------------------------------------------------------------------
// Check groups on the Today tab (WHO-390)
// ---------------------------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Does this group's reminder cover that slot? Mirrors the worker's claiming rule: a scheduled
 * group covers a *scheduled* member check's slot at one of the group's times, on a day the group
 * runs. Read in the browser's zone, which is the zone the slots were asked for in.
 */
export function groupCoversSlot(group: HealthCheckGroup, check: HealthCheck, slotIso: string): boolean {
  if (!group.enabled || group.scheduleKind !== "scheduled" || check.scheduleKind !== "scheduled") return false;
  if (!group.checks.some((c) => c.id === check.id)) return false;
  const at = new Date(slotIso);
  if (Number.isNaN(at.getTime())) return false;
  const localDate = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
  if (group.startDate && localDate < group.startDate) return false;
  if (group.endDate && localDate > group.endDate) return false;
  const days = group.schedule?.daysOfWeek ?? [];
  if (days.length > 0 && !days.includes(at.getDay())) return false;
  const hhmm = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  return (group.schedule?.times ?? []).some((t) => t.slice(0, 5) === hhmm);
}

/** One group's slot: the member checks it covers at one time. */
export interface CheckGroupCard {
  key: string;
  group: HealthCheckGroup;
  /** The instant of the group's time (the earliest of its members' slots, which are all the same minute). */
  scheduledAt: string;
  rows: CheckSlotRow[];
}

/**
 * Split a person's slots into the ones a group takes over (shown together under the group) and the
 * rest (shown on their own). A slot belongs to at most one group, the first that covers it, so a
 * check in two groups still shows each time once.
 */
export function splitCheckRowsByGroup(
  rows: readonly CheckSlotRow[],
  groups: readonly HealthCheckGroup[],
): { cards: CheckGroupCard[]; loose: CheckSlotRow[] } {
  const ordered = [...groups].sort((a, b) => a.id.localeCompare(b.id));
  const cards = new Map<string, CheckGroupCard>();
  const loose: CheckSlotRow[] = [];
  for (const row of rows) {
    const group = ordered.find((g) => groupCoversSlot(g, row.check, row.slot.scheduledAt));
    if (!group) {
      loose.push(row);
      continue;
    }
    const minute = Math.floor(Date.parse(row.slot.scheduledAt) / 60_000);
    const key = `${group.id}|${minute}`;
    const card = cards.get(key) ?? { key, group, scheduledAt: row.slot.scheduledAt, rows: [] };
    card.rows.push(row);
    cards.set(key, card);
  }
  const sorted = [...cards.values()].sort(
    (a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.group.name.localeCompare(b.group.name),
  );
  return { cards: sorted, loose };
}

/** The members of a group slot still waiting for an answer, in the order they are shown. */
export function pendingRows(rows: readonly CheckSlotRow[]): CheckSlotRow[] {
  return rows.filter((r) => isCheckSlotPending(r.slot.status));
}
