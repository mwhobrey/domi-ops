import { apiErrorCode } from "./pharmacy-helpers";
import type { HealthMedication } from "./health-types";
import type { PharmacySummary, SupplySummary } from "./supply-types";

/**
 * Pure helpers for the Supplies screen (WHO-422): how a supply looks, how medications are grouped and
 * ordered, and what to say when the API refuses. Dates are the household's calendar days ("YYYY-MM-DD"),
 * so they are formatted from their parts and never go through the browser's time zone.
 */

export type BadgeTone = "default" | "success" | "warning" | "accent" | "danger";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 14" for "2026-10-14"; an unreadable value comes back as it was. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : iso;
}

/** "9 days left", "1 day left", "Runs out today", "Ran out". */
export function daysLeftLabel(daysRemaining: number | null): string {
  if (daysRemaining === null) return "";
  if (daysRemaining <= 0) return "Out of supply";
  return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`;
}

/** "Requested today", "Requested yesterday", "Requested 3 days ago". */
export function requestAgeLabel(requestedAt: string | null, now: Date = new Date()): string {
  if (!requestedAt) return "";
  const t = Date.parse(requestedAt);
  if (Number.isNaN(t)) return "";
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  if (days === 0) return "Requested today";
  if (days === 1) return "Requested yesterday";
  return `Requested ${days} days ago`;
}

export type SupplyStatusView = { label: string; tone: BadgeTone };

/** The one word (or two) a medication's supply is summed up with. A paused medication is just "Paused". */
export function supplyStatus(supply: SupplySummary, enabled: boolean): SupplyStatusView {
  if (!enabled || supply.state === "inactive") return { label: "Paused", tone: "default" };
  switch (supply.state) {
    case "ok":
      return { label: "OK", tone: "success" };
    case "not_needed":
      return { label: "Covered", tone: "success" };
    case "needs_refill":
      return supply.overdue ? { label: "Overdue", tone: "danger" } : { label: "Needs refill", tone: "warning" };
    case "requested":
      return supply.overdue ? { label: "Requested · overdue", tone: "danger" } : { label: "Requested", tone: "accent" };
    case "no_estimate":
    default:
      return { label: "No estimate", tone: "default" };
  }
}

/** The small chip on a medication card: the status, plus the days left while that is the useful part. */
export function supplyChip(supply: SupplySummary, enabled: boolean): SupplyStatusView | null {
  if (supply.runsOutOn === null && supply.state === "no_estimate") return null;
  const status = supplyStatus(supply, enabled);
  if (!enabled || supply.daysRemaining === null) return status;
  if (supply.state === "ok" || supply.state === "needs_refill" || supply.state === "not_needed") {
    return { ...status, label: `${status.label} · ${supply.daysRemaining}d` };
  }
  return status;
}

/** Whether "Mark requested" makes sense: active, nothing open yet. */
export function canMarkRequested(supply: SupplySummary | undefined, enabled: boolean): boolean {
  return enabled && supply?.state !== "requested";
}

export type SupplyItem = { medication: HealthMedication; supply: SupplySummary | null };

export type SupplyGroup = {
  /** "none" for medications with no pharmacy. */
  key: string;
  pharmacy: PharmacySummary | null;
  items: SupplyItem[];
};

const FAR = "9999-12-31";

/** How urgent a row is: requested and needs-refill rows by deadline, then the rest by run-out date, then unknown. */
function urgency(item: SupplyItem): string {
  const s = item.supply;
  if (!item.medication.enabled) return `3|${FAR}`;
  if (!s) return `2|${FAR}`;
  if (s.state === "needs_refill" || s.state === "requested") return `0|${s.deadline ?? FAR}`;
  if (s.state === "ok" || s.state === "not_needed") return `1|${s.deadline ?? s.runsOutOn ?? FAR}`;
  return `2|${FAR}`;
}

/**
 * Medications grouped by pharmacy, most urgent first inside each group and between groups; the group
 * for medications with no pharmacy comes last. Does not change its input.
 */
export function groupBySupply(medications: readonly HealthMedication[]): SupplyGroup[] {
  const groups = new Map<string, SupplyGroup>();
  for (const medication of medications) {
    const pharmacy = medication.pharmacy ?? null;
    const key = pharmacy?.id ?? "none";
    const group = groups.get(key) ?? { key, pharmacy, items: [] };
    group.items.push({ medication, supply: medication.supply ?? null });
    groups.set(key, group);
  }
  const byUrgency = (a: SupplyItem, b: SupplyItem) =>
    urgency(a).localeCompare(urgency(b)) || a.medication.name.localeCompare(b.medication.name);
  const out = [...groups.values()].map((g) => ({ ...g, items: [...g.items].sort(byUrgency) }));
  return out.sort((a, b) => {
    if ((a.pharmacy === null) !== (b.pharmacy === null)) return a.pharmacy === null ? 1 : -1;
    return urgency(a.items[0]!).localeCompare(urgency(b.items[0]!)) || (a.pharmacy?.name ?? "").localeCompare(b.pharmacy?.name ?? "");
  });
}

/** Active medications with no run-out estimate yet: what the first-run setup walks through. A paused one is left alone. */
export function medsNeedingSetup(medications: readonly HealthMedication[]): HealthMedication[] {
  return medications
    .filter((m) => m.enabled && !m.supply?.runsOutOn)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Active medications whose estimate predates a pause and resume, so it has to be confirmed or replaced. */
export function medsNeedingConfirmation(medications: readonly HealthMedication[]): HealthMedication[] {
  return medications.filter((m) => m.enabled && m.supply?.needsConfirmation === true);
}

export type SetupRowPlan =
  | { kind: "skip" }
  | { kind: "invalid" }
  | { kind: "save"; body: { outsideDays?: number; pharmacyId?: string | null } };

/**
 * What to send for one row of the first-run setup: nothing when it was left alone, an error when the
 * days are not a number, otherwise the days and/or the pharmacy if it changed.
 */
export function planSetupRow(input: { daysText: string; pharmacyId: string; originalPharmacyId: string }): SetupRowPlan {
  const hasDays = input.daysText.trim() !== "";
  const days = hasDays ? parseDays(input.daysText, 3650) : null;
  if (hasDays && days === null) return { kind: "invalid" };
  const pharmacyChanged = input.pharmacyId !== input.originalPharmacyId;
  if (days === null && !pharmacyChanged) return { kind: "skip" };
  return {
    kind: "save",
    body: {
      ...(days !== null ? { outsideDays: days } : {}),
      ...(pharmacyChanged ? { pharmacyId: input.pharmacyId || null } : {}),
    },
  };
}

/** The local-storage key that remembers "not now" for one person's setup prompt. */
export function setupDismissKey(memberId: string): string {
  return `domi:supply-setup-dismissed:${memberId}`;
}

/** What the dry run said, ready to show. */
export type SupplyPreview =
  | { kind: "ok"; runsOutOn: string; totalDays: number; organizerDays: number; outsideDays: number }
  | { kind: "gap"; organizerDays: number; organizerEndsOn: string | null };

/** "Runs out Oct 20 · 35 days (31 in organizers + 4 outside)". */
export function previewLabel(p: Extract<SupplyPreview, { kind: "ok" }>): string {
  const parts = p.organizerDays > 0 ? ` (${p.organizerDays} in organizers + ${p.outsideDays} outside)` : "";
  return `Runs out ${formatDay(p.runsOutOn)} · ${p.totalDays} day${p.totalDays === 1 ? "" : "s"}${parts}`;
}

/** Reads a dry-run answer from either supply endpoint; null if it is not one. */
export function parsePreview(body: unknown): SupplyPreview | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.dryRun !== true) return null;
  if (b.needsConfirmation === true) {
    return {
      kind: "gap",
      organizerDays: typeof b.organizerDays === "number" ? b.organizerDays : 0,
      organizerEndsOn: typeof b.organizerEndsOn === "string" ? b.organizerEndsOn : null,
    };
  }
  if (typeof b.runsOutOn === "string" && typeof b.totalDays === "number") {
    return {
      kind: "ok",
      runsOutOn: b.runsOutOn,
      totalDays: b.totalDays,
      organizerDays: typeof b.organizerDays === "number" ? b.organizerDays : 0,
      outsideDays: typeof b.outsideDays === "number" ? b.outsideDays : 0,
    };
  }
  return null;
}

/** A whole number of days from what was typed, or null when it is blank or not one. */
export function parseDays(text: string, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

const MESSAGES: Record<string, string> = {
  invalid_outside_days: "Enter a whole number of days, from 0 to 3650.",
  invalid_confirmed_total: "Enter a whole number of days, from 0 to 3650.",
  invalid_lead_days: "Enter a whole number of days, from 0 to 90.",
  supply_too_large: "That is more than ten years of supply. Check the number of days.",
  confirmation_required: "The organizers have a gap, so enter the total days you have in hand.",
  version_conflict: "Someone else changed this supply. Reload and try again.",
  medication_inactive: "This medication is paused. Resume it first.",
  medication_not_found: "That medication no longer exists.",
  pharmacy_not_found: "That pharmacy no longer exists. Reload and try again.",
  pharmacy_archived: "That pharmacy is archived. Restore it first, or pick another.",
  no_estimate_to_confirm: "There is no estimate to confirm yet. Enter the days you have.",
  forbidden: "You do not have permission to change this supply.",
};

/** A sentence for the person, never a raw code. */
export function supplyErrorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  return (code && MESSAGES[code]) || fallback;
}
