import { healthEventTypeEnum, healthPainBodyRegionEnum, healthVitalsMetricEnum } from "@domi-ops/db";

/**
 * Health checks (WHO-382): the event type a check asks for, and the per-type field template that
 * pre-fills the log sheet (e.g. which vitals to prompt for). Pure: no I/O, so it is unit tested.
 */

/** Every `health_events.type` except `medication` (doses go through medication logs, not checks). */
export const CHECK_EVENT_TYPES: readonly string[] = healthEventTypeEnum.enumValues.filter(
  (t) => t !== "medication",
);

export type CheckEventType = Exclude<(typeof healthEventTypeEnum.enumValues)[number], "medication">;

export function isCheckEventType(value: unknown): value is CheckEventType {
  return typeof value === "string" && CHECK_EVENT_TYPES.includes(value);
}

export type CheckTemplate = {
  /** Default title for the logged event. */
  title?: string;
  /** vitals: the metrics to prompt for, in display order. */
  metrics?: string[];
  /** pain: body regions to pre-select. */
  regions?: string[];
  /** exercise: default activity name. */
  activity?: string;
};

export type CheckTemplateErrorCode =
  | "invalid_template"
  | "template_requires_metrics"
  | "unknown_vitals_metric"
  | "unknown_pain_region"
  | "invalid_template_field";

export class CheckTemplateError extends Error {
  constructor(public readonly code: CheckTemplateErrorCode) {
    super(code);
    this.name = "CheckTemplateError";
  }
}

const MAX_TEXT = 120;

const VITALS_METRICS: readonly string[] = healthVitalsMetricEnum.enumValues;
const PAIN_REGIONS: readonly string[] = healthPainBodyRegionEnum.enumValues;

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CheckTemplateError("invalid_template_field");
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TEXT) throw new CheckTemplateError("invalid_template_field");
  return trimmed;
}

function stringList(value: unknown, allowed: readonly string[], unknownCode: CheckTemplateErrorCode): string[] {
  if (!Array.isArray(value)) throw new CheckTemplateError("invalid_template_field");
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.includes(entry)) throw new CheckTemplateError(unknownCode);
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/**
 * Validate a client-supplied template for `eventType`. Unknown keys are dropped (a pain template
 * with `metrics` just ignores it); bad values for known keys are rejected. A vitals check must
 * name at least one metric, since "log vitals" with nothing to prompt for is not a usable check.
 */
export function normalizeCheckTemplate(eventType: CheckEventType, raw: unknown): CheckTemplate {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new CheckTemplateError("invalid_template");
  const input = raw as Record<string, unknown>;

  const out: CheckTemplate = {};
  const title = optionalText(input.title);
  if (title) out.title = title;

  switch (eventType) {
    case "vitals": {
      const metrics = stringList(input.metrics ?? [], VITALS_METRICS, "unknown_vitals_metric");
      if (metrics.length === 0) throw new CheckTemplateError("template_requires_metrics");
      out.metrics = metrics;
      break;
    }
    case "pain": {
      if (input.regions !== undefined && input.regions !== null) {
        const regions = stringList(input.regions, PAIN_REGIONS, "unknown_pain_region");
        if (regions.length > 0) out.regions = regions;
      }
      break;
    }
    case "exercise": {
      const activity = optionalText(input.activity);
      if (activity) out.activity = activity;
      break;
    }
    default:
      break;
  }
  return out;
}

/** Tolerant read of a stored (already decrypted) template: junk becomes an empty template. */
export function parseCheckTemplate(raw: string | null | undefined): CheckTemplate {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CheckTemplate = {};
    if (typeof parsed.title === "string" && parsed.title) out.title = parsed.title;
    if (Array.isArray(parsed.metrics)) {
      out.metrics = parsed.metrics.filter((m): m is string => typeof m === "string");
    }
    if (Array.isArray(parsed.regions)) {
      out.regions = parsed.regions.filter((r): r is string => typeof r === "string");
    }
    if (typeof parsed.activity === "string" && parsed.activity) out.activity = parsed.activity;
    return out;
  } catch {
    return {};
  }
}

/** `YYYY-MM-DD` and a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type CheckDateRangeError = "invalid_date" | "end_before_start";

/** Validate optional start/end dates; `null`/`undefined` mean "no bound". */
export function validateCheckDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): CheckDateRangeError | null {
  if (startDate != null && !isIsoDate(startDate)) return "invalid_date";
  if (endDate != null && !isIsoDate(endDate)) return "invalid_date";
  if (startDate && endDate && endDate < startDate) return "end_before_start";
  return null;
}
