import { minutesToAmountUnit } from "./MedScheduleEditor";
import {
  PAIN_BODY_REGION_LABELS,
  VITALS_METRICS,
  type HealthCheck,
  type HealthCheckTemplate,
  type HealthEventType,
} from "./health-types";

/** The kinds of entry a check can ask for, as people name them. */
export const CHECK_TYPE_OPTIONS: { value: HealthEventType; label: string }[] = [
  { value: "vitals", label: "Vitals" },
  { value: "food_intake", label: "Food" },
  { value: "pain", label: "Pain" },
  { value: "exercise", label: "Exercise" },
  { value: "symptom", label: "Symptom" },
  { value: "other", label: "Other" },
];

export function checkTypeLabel(type: HealthEventType): string {
  return (
    CHECK_TYPE_OPTIONS.find((o) => o.value === type)?.label ??
    type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** The usual pair for watching blood pressure. */
export const BP_HEART_RATE_PRESET: string[] = ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"];

/** What the setup sheet edits before it becomes the API's per-type template. */
export type CheckTemplateDraft = {
  /** Default title for the logged entry. */
  title: string;
  /** Vitals: metrics to prompt for. */
  metrics: string[];
  /** Pain: regions to pre-select. */
  regions: string[];
  /** Exercise: default activity. */
  activity: string;
};

export function emptyTemplateDraft(eventType: HealthEventType): CheckTemplateDraft {
  return {
    title: "",
    // Most vitals checks are blood pressure, so start there rather than at nothing.
    metrics: eventType === "vitals" ? [...BP_HEART_RATE_PRESET] : [],
    regions: [],
    activity: "",
  };
}

export function templateToDraft(template: HealthCheckTemplate | undefined): CheckTemplateDraft {
  return {
    title: template?.title ?? "",
    metrics: template?.metrics ?? [],
    regions: template?.regions ?? [],
    activity: template?.activity ?? "",
  };
}

/** Metrics in the app's own order, so toggling one on and off never reshuffles the prompt order. */
export function orderedMetrics(metrics: readonly string[]): string[] {
  const order = VITALS_METRICS.map((m) => m.value as string);
  return [...new Set(metrics)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Shape the draft for the API, which keeps only the fields that belong to the type. */
export function templateDraftToRequest(
  eventType: HealthEventType,
  draft: CheckTemplateDraft,
): { ok: true; template: HealthCheckTemplate } | { ok: false; error: string } {
  const template: HealthCheckTemplate = {};
  const title = draft.title.trim();
  if (title) template.title = title;
  if (eventType === "vitals") {
    if (draft.metrics.length === 0) return { ok: false, error: "Pick at least one reading to prompt for." };
    template.metrics = orderedMetrics(draft.metrics);
  } else if (eventType === "pain") {
    const regions = [...new Set(draft.regions)].filter((r) => Object.hasOwn(PAIN_BODY_REGION_LABELS, r));
    if (regions.length > 0) template.regions = regions;
  } else if (eventType === "exercise") {
    const activity = draft.activity.trim();
    if (activity) template.activity = activity;
  }
  return { ok: true, template };
}

/**
 * "0, 15" or "0 15" -> [0, 15]: minutes before each time, whole numbers, no repeats, ascending.
 * Blank means a single reminder at the time itself. Anything that isn't a whole number of minutes
 * ("15m", "-5", "1.5") is an error to show, not something to quietly replace with 0.
 */
export function parseReminderOffsets(
  text: string,
): { ok: true; offsets: number[] } | { ok: false; error: string } {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { ok: true, offsets: [0] };
  const offsets: number[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      return {
        ok: false,
        error: `"${token}" isn't a number of minutes. Use whole numbers like 0, 15.`,
      };
    }
    offsets.push(Number(token));
  }
  return { ok: true, offsets: [...new Set(offsets)].sort((a, b) => a - b) };
}

/** Gentle nudge shown while there is no end date; it never blocks saving. */
export function endDateHint(endDate: string): string | null {
  return endDate.trim() ? null : "Monitoring checks usually have an end date. Without one it repeats until you pause or delete it.";
}

export function dateRangeError(startDate: string, endDate: string): string | null {
  if (startDate && endDate && endDate < startDate) return "The end date is before the start date.";
  return null;
}

const CHECK_ERROR_TEXT: Record<string, string> = {
  template_requires_metrics: "Pick at least one reading to prompt for.",
  unknown_vitals_metric: "One of the readings is not one we know.",
  unknown_pain_region: "One of the body regions is not one we know.",
  invalid_template_field: "One of the entry fields is too long or not text.",
  invalid_template: "The entry fields are not valid.",
  scheduled_checks_require_times: "Add at least one time.",
  invalid_schedule: "That schedule is not valid.",
  check_schedule_must_be_scheduled_or_interval: "Pick scheduled times or an interval.",
  invalid_date: "One of the dates is not valid.",
  end_before_start: "The end date is before the start date.",
  member_not_found: "That person is not in this household.",
  forbidden: "You can't change checks for this person.",
  not_found: "That check no longer exists.",
};

/** A readable message for a failed save: the API's error code in words, else a generic line. */
export function checkErrorMessage(error: unknown, fallback = "Save failed"): string {
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body === "string") {
    try {
      const code = (JSON.parse(body) as { error?: unknown }).error;
      if (typeof code === "string") return CHECK_ERROR_TEXT[code] ?? fallback;
    } catch {
      // not JSON
    }
  }
  return fallback;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "8:00 AM, 12:00 PM · Mon, Wed" or "Every 4 hours". */
export function checkScheduleSummary(check: Pick<HealthCheck, "scheduleKind" | "schedule">): string {
  const schedule = check.schedule ?? {};
  if (check.scheduleKind === "interval") {
    const { everyAmount, everyUnit } = minutesToAmountUnit(schedule.everyMinutes);
    if (!everyAmount) return "Repeats on an interval";
    const unit = everyUnit === "minutes" ? "minute" : everyUnit === "hours" ? "hour" : "day";
    return `Every ${everyAmount === "1" ? "" : `${everyAmount} `}${unit}${everyAmount === "1" ? "" : "s"}`;
  }
  const times = (schedule.times ?? []).map(timeLabel).join(", ") || "No times set";
  const days = schedule.daysOfWeek ?? [];
  return days.length > 0 && days.length < 7 ? `${times} · ${days.map((d) => DAY_NAMES[d] ?? "?").join(", ")}` : times;
}

/** "Oct 2 – Oct 16", "from Oct 2", "until Oct 16" or null when it has neither bound. */
export function checkDateRangeSummary(check: Pick<HealthCheck, "startDate" | "endDate">): string | null {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  if (check.startDate && check.endDate) return `${fmt(check.startDate)} – ${fmt(check.endDate)}`;
  if (check.startDate) return `from ${fmt(check.startDate)}`;
  if (check.endDate) return `until ${fmt(check.endDate)}`;
  return null;
}
