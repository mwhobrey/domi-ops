import { apiErrorCode } from "./pharmacy-helpers";
import { formatDay } from "./supply-helpers";
import type { HealthMedication } from "./health-types";
import type { NotGuidedReason, OrganizerCompartment, OrganizerPlan, OrganizerStep } from "./organizer-types";

/**
 * Pure helpers for setting up a pill organizer (WHO-427): reading and showing pill quantities the way people say
 * them ("1½", "3/4"), matching groups to compartments, and turning what the plan says is missing into a checklist.
 */

export const MIN_PILLS = 0.25;
export const MAX_PILLS = 100;

const FRACTION_CHARS: Record<string, string> = { "¼": "1/4", "½": "1/2", "¾": "3/4" };

export type QuantityParse = { ok: true; pills: number } | { ok: false; reason: "empty" | "invalid" | "not_quarter" | "range" };

/**
 * A pill count as someone types it: "2", "1.5", ".25", "1/2", "1 1/2", "1½", "¾". Only whole quarters of a pill are
 * allowed (that is how organizers are filled), between a quarter and a hundred.
 */
export function parseQuantityInput(text: string): QuantityParse {
  let t = text.trim();
  if (t === "") return { ok: false, reason: "empty" };
  for (const [ch, frac] of Object.entries(FRACTION_CHARS)) t = t.replaceAll(ch, ` ${frac}`);
  t = t.replace(/\s+/g, " ").trim();

  let quarters: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)?(?:\.(\d+))?$/.exec(t)) && t !== "" && t !== ".") {
    // a plain or decimal number
    const value = Number(t);
    if (!Number.isFinite(value)) return { ok: false, reason: "invalid" };
    const q = value * 4;
    if (Math.abs(q - Math.round(q)) > 1e-9) return { ok: false, reason: "not_quarter" };
    quarters = Math.round(q);
  } else if ((m = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(t))) {
    const whole = m[1] ? Number(m[1]) : 0;
    const num = Number(m[2]);
    const den = Number(m[3]);
    if (den === 0) return { ok: false, reason: "invalid" };
    const q = ((whole * den + num) * 4) / den;
    if (Math.abs(q - Math.round(q)) > 1e-9) return { ok: false, reason: "not_quarter" };
    quarters = Math.round(q);
  }
  if (quarters === null) return { ok: false, reason: "invalid" };
  if (quarters < 1 || quarters > MAX_PILLS * 4) return { ok: false, reason: "range" };
  return { ok: true, pills: quarters / 4 };
}

const FRACTION_FOR: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** 1 -> "1", 1.5 -> "1½", 0.25 -> "¼". Rounded to the nearest quarter. */
export function formatPills(pills: number): string {
  const quarters = Math.round(pills * 4);
  const whole = Math.floor(quarters / 4);
  const frac = FRACTION_FOR[(quarters % 4) / 4] ?? "";
  if (whole === 0) return frac || "0";
  return `${whole}${frac}`;
}

/** One tap of + or -: a quarter more or less, from nothing to one pill, never below a quarter or above the limit. */
export function stepQuantity(current: number | null, direction: 1 | -1): number | null {
  if (current === null) return direction > 0 ? 1 : null;
  const next = current + direction * 0.25;
  if (next < MIN_PILLS) return MIN_PILLS;
  return next > MAX_PILLS ? MAX_PILLS : next;
}

export type GroupLike = { id: string; name: string; scheduleKind: string; enabled: boolean; schedule: Record<string, unknown> };

/** The dose times ("HH:MM", sorted) a scheduled group runs at. */
export function groupTimes(group: GroupLike): string[] {
  if (group.scheduleKind !== "scheduled") return [];
  const times = Array.isArray(group.schedule.times) ? (group.schedule.times as unknown[]) : [];
  return [...new Set(times.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 5)))].sort();
}

export type GroupSuggestion = {
  compartmentId: string;
  compartmentName: string;
  groupId: string;
  groupName: string;
  times: string[];
};

/**
 * Groups named like a compartment ("Morning", "Lunch" ...): one tap sends all of the group's times to that
 * compartment. A group whose times are all there already is not suggested again.
 */
export function suggestGroupMappings(
  groups: readonly GroupLike[],
  compartments: readonly OrganizerCompartment[],
  timeMap: Readonly<Record<string, string>>,
): GroupSuggestion[] {
  const out: GroupSuggestion[] = [];
  for (const compartment of compartments) {
    const wanted = compartment.name.trim().toLowerCase();
    for (const group of groups) {
      if (!group.enabled || group.name.trim().toLowerCase() !== wanted) continue;
      const times = groupTimes(group);
      if (times.length === 0) continue;
      if (times.every((t) => timeMap[t] === compartment.id)) continue;
      out.push({ compartmentId: compartment.id, compartmentName: compartment.name, groupId: group.id, groupName: group.name, times });
    }
  }
  return out;
}

const ORDINAL_SUFFIX = ["th", "st", "nd", "rd"];
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${ORDINAL_SUFFIX[(v - 20) % 10] ?? ORDINAL_SUFFIX[v] ?? ORDINAL_SUFFIX[0]}`;
}

/** "Every 30 days, starting Oct 6" or "On the 31st of each month (the last day in shorter months)". */
export function scheduleSummary(plan: Pick<OrganizerPlan, "scheduleKind" | "everyN" | "monthlyDay" | "anchorDate">): string {
  if (plan.scheduleKind === "every_n_days") {
    const n = plan.everyN ?? 1;
    return `${n === 1 ? "Every day" : `Every ${n} days`}, starting ${formatDay(plan.anchorDate)}`;
  }
  const day = plan.monthlyDay ?? 1;
  return `On the ${ordinal(day)} of each month${day > 28 ? " (the last day in shorter months)" : ""}`;
}

const REASONS: Record<NotGuidedReason, string> = {
  as_needed: "taken as needed",
  over_the_counter: "over the counter",
  interval: "repeats every few hours",
  paused: "paused",
  no_times: "has no fixed times",
};
export const notGuidedReasonLabel = (reason: NotGuidedReason): string => REASONS[reason] ?? reason;

export type ChecklistItem = {
  key: string;
  status: "ok" | "todo" | "info";
  title: string;
  detail?: string;
  /** The step of the setup sheet that fixes it. */
  step?: OrganizerStep;
};

/** What the plan says is missing, as a list a person can work through, each with the step that fixes it. */
export function setupChecklist(plan: OrganizerPlan, medications: readonly Pick<HealthMedication, "id" | "name">[]): ChecklistItem[] {
  const name = (id: string) => medications.find((m) => m.id === id)?.name ?? "A medication";
  const items: ChecklistItem[] = [];
  const { problems, notGuided, doseTimes, ready } = plan.setup;

  const unmapped = problems.filter((p) => p.kind === "unmapped_time");
  if (unmapped.length > 0) {
    items.push({
      key: "times",
      status: "todo",
      title: `${unmapped.length} dose time${unmapped.length === 1 ? " has" : "s have"} no compartment`,
      detail: unmapped.map((p) => p.time).join(", "),
      step: "times",
    });
  }

  const missing = problems.filter((p) => p.kind === "missing_quantity");
  if (missing.length > 0) {
    const byMed = new Map<string, string[]>();
    for (const p of missing) byMed.set(p.medicationId, [...(byMed.get(p.medicationId) ?? []), p.time]);
    items.push({
      key: "quantities",
      status: "todo",
      title: `Pill amounts are missing for ${byMed.size} medication${byMed.size === 1 ? "" : "s"}`,
      detail: [...byMed].map(([id, times]) => `${name(id)} (${times.join(", ")})`).join("; "),
      step: "quantities",
    });
  }

  if (notGuided.length > 0) {
    const reasons = new Map<NotGuidedReason, string[]>();
    for (const n of notGuided) reasons.set(n.reason, [...(reasons.get(n.reason) ?? []), name(n.medicationId)]);
    items.push({
      key: "not-guided",
      status: "info",
      title: "Left out of the organizer",
      detail: [...reasons].map(([reason, names]) => `${names.join(", ")}: ${notGuidedReasonLabel(reason)}`).join("; "),
    });
  }

  const clashes = problems.filter((p) => p.kind === "double_claim");
  if (clashes.length > 0) {
    items.push({
      key: "double-claim",
      status: "info",
      title: `${clashes.length} dose${clashes.length === 1 ? " is" : "s are"} in two groups at once`,
      detail: "Each is put in the organizer once.",
    });
  }

  if (ready) items.push({ key: "ready", status: "ok", title: "Ready to fill" });
  else if (items.every((i) => i.status === "info") && doseTimes.length === 0) {
    items.unshift({ key: "no-doses", status: "todo", title: "No medications with fixed times yet", detail: "Add scheduled medications to fill an organizer with." });
  }
  return items;
}

const MESSAGES: Record<string, string> = {
  plan_exists: "This person already has a pill organizer plan. Reload the page.",
  version_conflict: "Someone else changed the plan. Reload and try again.",
  forbidden: "You do not have permission to change this plan.",
  invalid_every_n: "Enter a number of days from 1 to 365.",
  invalid_monthly_day: "Enter a day of the month from 1 to 31.",
  invalid_anchor_date: "Enter a real date.",
  invalid_fill_length: "A fill covers 1 to 93 days.",
  invalid_reminder_time: "Enter a time like 09:00.",
  invalid_compartment_name: "Each compartment needs a name of up to 40 characters.",
  duplicate_compartment_name: "Two compartments have the same name.",
  too_many_compartments: "An organizer can have up to 8 compartments.",
  invalid_compartments: "Keep at least one compartment.",
  compartment_not_found: "A compartment in that request no longer exists. Reload and try again.",
  invalid_time_map: "One of those times could not be used.",
  caregiver_no_access: "Everyone reminded must be able to see this person's medications.",
  caregiver_not_found: "One of those people is no longer in the household.",
  group_not_found: "That group no longer exists.",
  invalid_group_assignment: "That group has no fixed times to use.",
  open_session: "Finish or abandon the open filling session first.",
  quantity_time_not_scheduled: "That medication does not take a dose at that time.",
  quantity_out_of_range: "Use between ¼ and 100 pills.",
  quantity_not_quarter_step: "Use whole quarters of a pill.",
};

/** A sentence for the person, never a raw code. */
export function organizerErrorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  return (code && MESSAGES[code]) || fallback;
}
