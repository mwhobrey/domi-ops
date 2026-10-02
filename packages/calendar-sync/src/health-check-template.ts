/**
 * The per-type field template of a health check (e.g. which vitals metrics to prompt for), as it
 * is stored. Lives here, not in the API, because the reminder worker needs to read it too: a
 * vitals check only counts an unlinked reading that holds every metric the template names.
 * Validation of what a client sends stays in the API (`health-check-template.ts` there).
 */
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
