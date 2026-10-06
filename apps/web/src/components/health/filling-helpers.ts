import { ApiError } from "../../lib/client-api";
import { apiErrorCode } from "./pharmacy-helpers";
import { formatDay } from "./supply-helpers";
import type { DateRange, FillStatus, SessionCompartment, SessionMedication, SessionPlacement, SessionView } from "./filling-types";

/**
 * Pure helpers for the filling screen (WHO-428): which days a fill covers, how a medication's doses group into
 * compartments, how far along the session is, and what to say when the API refuses. Dates are household calendar
 * days ("YYYY-MM-DD"), handled as UTC dates so the browser's time zone never moves them.
 */

const DAY_MS = 86_400_000;

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Days in a range, both ends counted. */
export const rangeDays = (r: DateRange): number => daysBetween(r.from, r.to) + 1;

/** "Oct 6" for a single day, "Oct 6 – Oct 20" for a stretch. */
export function rangeLabel(r: DateRange): string {
  return r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`;
}

export function rangesLabel(ranges: readonly DateRange[]): string {
  return ranges.map(rangeLabel).join(", ");
}

/** count(1, "day") -> "1 day"; count(3, "day") -> "3 days". */
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const STATUS: Record<FillStatus, { label: string; tone: "default" | "success" | "warning" }> = {
  pending: { label: "To fill", tone: "default" },
  partial: { label: "Partly filled", tone: "warning" },
  filled: { label: "Filled", tone: "success" },
  nothing_to_fill: { label: "Nothing to fill", tone: "default" },
};
export const statusView = (status: FillStatus) => STATUS[status];

/** Medications whose name or dosage contains what was typed, in the order given. Blank shows everything. */
export function filterMedications(medications: readonly SessionMedication[], query: string): SessionMedication[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...medications];
  return medications.filter((m) => m.name.toLowerCase().includes(q) || (m.dosage ?? "").toLowerCase().includes(q));
}

/** "3 of 11 medications filled" with any partly filled ones mentioned. */
export function progressLabel(progress: SessionView["progress"]): string {
  const base = `${progress.filled} of ${count(progress.total, "medication")} filled`;
  return progress.partial > 0 ? `${base}, ${progress.partial} partly` : base;
}

/**
 * The stretch to offer when a medication is selected: the first run of days still unfilled, which for a new medication
 * is the whole session and after a short fill is whatever is left. Null when nothing is left.
 */
export function defaultFillRange(med: Pick<SessionMedication, "missing">): DateRange | null {
  const first = med.missing[0];
  return first ? { from: first.from, to: first.to } : null;
}

/** The last day of a fill that starts at `from` and covers `days` days, never past the end of the session. */
export function fillEnd(from: string, days: number, windowEnd: string): string {
  const to = addDays(from, Math.max(1, days) - 1);
  return to > windowEnd ? windowEnd : to;
}

/** Days with a dose in `missing` that a fill of `range` would still leave unfilled. */
export function daysLeftAfter(range: DateRange, missing: readonly DateRange[]): number {
  let left = 0;
  for (const m of missing) {
    const from = m.from > range.from ? m.from : range.from;
    const to = m.to < range.to ? m.to : range.to;
    const overlap = from <= to ? daysBetween(from, to) + 1 : 0;
    left += rangeDays(m) - overlap;
  }
  return left;
}

/** The unfilled days after a fill of `range`, as ranges (for showing which days are still to do). */
export function missingAfter(range: DateRange, missing: readonly DateRange[]): DateRange[] {
  const out: DateRange[] = [];
  for (const m of missing) {
    if (range.to < m.from || range.from > m.to) {
      out.push({ ...m });
      continue;
    }
    if (m.from < range.from) out.push({ from: m.from, to: addDays(range.from, -1) });
    if (m.to > range.to) out.push({ from: addDays(range.to, 1), to: m.to });
  }
  return out;
}

export type DoseLine = { time: string; pills: number; ranges: DateRange[]; days: number };
export type CompartmentLines = { compartment: SessionCompartment; pills: number; lines: DoseLine[] };

/** Consecutive days run together; days apart stay separate. Input need not be sorted or unique. */
export function runsOfDates(dates: readonly string[]): DateRange[] {
  const sorted = [...new Set(dates)].sort();
  const out: DateRange[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === d) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
}

/**
 * One medication's doses by compartment: for each compartment it goes in, each dose time and amount with the days it applies
 * to ("08:00 · 1½ pills · Oct 6 – Oct 20, Oct 22"). Compartments come in their order in the organizer.
 */
export function compartmentLines(
  placements: readonly SessionPlacement[],
  compartments: readonly SessionCompartment[],
): CompartmentLines[] {
  const out: CompartmentLines[] = [];
  for (const compartment of [...compartments].sort((a, b) => a.position - b.position)) {
    const mine = placements.filter((p) => p.compartmentId === compartment.id);
    if (mine.length === 0) continue;
    const byLine = new Map<string, { time: string; pills: number; dates: string[] }>();
    for (const p of mine) {
      const key = `${p.time}|${p.pills}`;
      const line = byLine.get(key) ?? { time: p.time, pills: p.pills, dates: [] };
      line.dates.push(p.date);
      byLine.set(key, line);
    }
    const lines = [...byLine.values()]
      .sort((a, b) => a.time.localeCompare(b.time) || a.pills - b.pills)
      .map((l) => ({ time: l.time.slice(0, 5), pills: l.pills, ranges: runsOfDates(l.dates), days: new Set(l.dates).size }));
    out.push({ compartment, pills: mine.reduce((sum, p) => sum + p.pills, 0), lines });
  }
  return out;
}

/** A fresh key for one attempt at saving a fill: a retry of the same attempt reuses it, so it is recorded once. */
export function newFillKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** The session an error response carries, for the answers that hand back the current one (409s). Null for anything else. */
export function sessionFromConflict(err: unknown): SessionView | null {
  if (!(err instanceof ApiError) || !err.body) return null;
  try {
    const session = (JSON.parse(err.body) as { session?: SessionView }).session;
    return session && typeof session === "object" && typeof session.id === "string" && Array.isArray(session.medications) ? session : null;
  } catch {
    return null;
  }
}

/** What the person is told when a 409 handed back newer state, so nobody wonders why the screen changed. */
const CONFLICT: Record<string, string> = {
  version_conflict: "Someone else changed this session, so it was reloaded. Check it and try again.",
  review_required: "The instructions changed since this session started, so filling is paused until they are reviewed.",
  session_not_open: "This session has already ended.",
  not_last_fill: "A newer fill exists for that medication.",
};

const MESSAGES: Record<string, string> = {
  ...CONFLICT,
  invalid_range: "Pick days that fall inside this session.",
  range_outside_session: "Those days are outside this session.",
  invalid_outside_days: "Enter a whole number of days, from 0 to 3650.",
  invalid_confirmed_total: "Enter a whole number of days, from 0 to 3650.",
  supply_too_large: "That is more than ten years of supply. Check the number of days.",
  confirmation_required: "The organizers have a gap, so enter the total days you have in hand.",
  idempotency_key_reused: "That save was already used for different days. Try again.",
  medication_not_found: "That medication is not part of this session, or you cannot see it.",
  nothing_filled: "Fill at least one medication before finishing.",
  nothing_to_fill: "There is nothing to put in the organizer for those days.",
  setup_incomplete: "The organizer setup is not finished yet. Open it and check the list.",
  session_not_found: "That session no longer exists.",
  plan_not_found: "That organizer no longer exists.",
  forbidden: "You do not have permission to fill this organizer.",
  too_many: "This person has reached the limit of filling sessions.",
};

/** A sentence for the person, never a raw code. */
export function fillErrorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  return (code && MESSAGES[code]) || fallback;
}

/** True for the answers that mean "your view was out of date": the screen reloads from the session they carry. */
export function isStaleAnswer(err: unknown): boolean {
  const code = apiErrorCode(err);
  return code !== null && code in CONFLICT;
}

export type FinishSummary = {
  filled: SessionMedication[];
  partial: Array<{ medication: SessionMedication; missing: DateRange[] }>;
  pending: SessionMedication[];
  nothingToFill: SessionMedication[];
};

/** What the session did and what it left: for the confirmation before finishing and the summary after. */
export function finishSummary(session: Pick<SessionView, "medications">): FinishSummary {
  const out: FinishSummary = { filled: [], partial: [], pending: [], nothingToFill: [] };
  for (const m of session.medications) {
    if (m.status === "filled") out.filled.push(m);
    else if (m.status === "partial") out.partial.push({ medication: m, missing: m.missing });
    else if (m.status === "pending") out.pending.push(m);
    else out.nothingToFill.push(m);
  }
  return out;
}
