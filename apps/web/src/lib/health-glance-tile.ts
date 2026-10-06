import type { GlancePreviewItem } from "../components/ui";
import { formatDay } from "../components/health/supply-helpers";

export type GlanceTone = "default" | "warning" | "success";

export type GlanceTileModel = {
  key: string;
  label: string;
  href: string;
  headline: string;
  tone: GlanceTone;
  items: GlancePreviewItem[];
  overflowCount: number;
  emptyHint?: string;
};

/** `GET /api/health/glance`, as far as the dashboard tile uses it. */
export type HealthGlance = {
  enabled?: boolean;
  pendingDoses?: {
    medicationId: string;
    name: string;
    dosage: string | null;
    scheduledAt: string;
    scheduledTimeLabel: string;
    awaitingFirst?: boolean;
    memberLabel?: string | null;
    isSelf?: boolean;
  }[];
  pendingGroupDoses?: {
    groupId: string;
    name: string;
    scheduledAt: string;
    scheduledTimeLabel: string;
    memberLabel?: string | null;
    isSelf?: boolean;
  }[];
  /** Today's scheduled health check slots still waiting for an answer (WHO-392). */
  pendingChecks?: {
    checkId: string;
    name: string;
    scheduledAt: string;
    scheduledTimeLabel: string;
    status: "upcoming" | "due" | "overdue";
    memberLabel?: string | null;
    isSelf?: boolean;
  }[];
  /** Today's check slots answered with a reading, out of all of today's. */
  checkProgress?: { done: number; total: number };
  /** Medications whose refill deadline has come and that nobody has asked the pharmacy for yet, soonest first (WHO-431). */
  refillsDue?: {
    medicationId: string;
    name: string;
    runsOutOn: string;
    daysRemaining: number | null;
    overdue: boolean;
    memberLabel?: string | null;
    isSelf?: boolean;
  }[];
};

/** "Lunch Meds · Ally" for someone else's dose; just the name for your own. */
function doseLabel(d: { name: string; memberLabel?: string | null; isSelf?: boolean }): string {
  if (d.isSelf !== false || !d.memberLabel) return d.name;
  return `${d.name} · ${d.memberLabel.split(" ")[0]}`;
}

type HealthGlanceItem = {
  key: string;
  label: string;
  scheduledAt: string;
  scheduledTimeLabel: string;
  metaExtra?: string | null;
  awaitingFirst?: boolean;
  kind: "dose" | "check";
  /** Overrides "the time has passed" for items that have their own idea of late. */
  late?: boolean;
  href: string;
};

/**
 * The dashboard's Health tile: what is waiting today, doses and scheduled checks together. A dose is
 * late once its time has passed; a check is late once it is more than half an hour past (the point
 * where it counts as overdue), because a reading is normally taken around the time, not at it.
 */
export function buildHealthTile(glance: HealthGlance | null, nowMs: number = Date.now()): GlanceTileModel | null {
  if (!glance) return null;
  const pending: HealthGlanceItem[] = [
    ...(glance.pendingGroupDoses ?? []).map((d): HealthGlanceItem => ({
      key: `group:${d.groupId}-${d.scheduledAt}`,
      label: doseLabel(d),
      scheduledAt: d.scheduledAt,
      scheduledTimeLabel: d.scheduledTimeLabel,
      kind: "dose",
      href: `/health?takeGroup=${encodeURIComponent(d.groupId)}&scheduledAt=${encodeURIComponent(d.scheduledAt)}`,
    })),
    ...(glance.pendingDoses ?? []).map((d): HealthGlanceItem => ({
      key: `${d.medicationId}-${d.scheduledAt}`,
      label: doseLabel(d),
      scheduledAt: d.scheduledAt,
      scheduledTimeLabel: d.scheduledTimeLabel,
      metaExtra: d.dosage,
      awaitingFirst: d.awaitingFirst,
      kind: "dose",
      href: `/health?take=${encodeURIComponent(d.medicationId)}&scheduledAt=${encodeURIComponent(d.scheduledAt)}`,
    })),
    ...(glance.pendingChecks ?? []).map((c): HealthGlanceItem => ({
      key: `check:${c.checkId}-${c.scheduledAt}`,
      label: doseLabel(c),
      scheduledAt: c.scheduledAt,
      scheduledTimeLabel: c.scheduledTimeLabel,
      kind: "check",
      late: c.status === "overdue",
      href: `/health?check=${encodeURIComponent(c.checkId)}&scheduledAt=${encodeURIComponent(c.scheduledAt)}`,
    })),
  ].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const isLate = (d: HealthGlanceItem) => {
    if (d.late !== undefined) return d.late;
    if (d.awaitingFirst) return false;
    const at = Date.parse(d.scheduledAt);
    return Number.isFinite(at) && at < nowMs;
  };
  const overdueCount = pending.filter(isLate).length;
  const dosesCount = pending.filter((d) => d.kind === "dose").length;
  const checksCount = pending.length - dosesCount;

  let headline: string;
  let tone: GlanceTone;
  if (pending.length === 0) {
    headline = "All clear";
    tone = "success";
  } else if (overdueCount > 0) {
    headline = `${overdueCount} overdue`;
    tone = "warning";
  } else if (checksCount === 0) {
    headline = `${dosesCount} dose${dosesCount === 1 ? "" : "s"}`;
    tone = "default";
  } else if (dosesCount === 0) {
    headline = `${checksCount} check${checksCount === 1 ? "" : "s"}`;
    tone = "default";
  } else {
    headline = `${pending.length} to do`;
    tone = "default";
  }

  // Refills come after what is waiting today: they are due, but not at a time of day.
  const refills = glance.refillsDue ?? [];
  if (refills.length > 0) {
    const refillText = `${refills.length} refill${refills.length === 1 ? "" : "s"}`;
    if (pending.length === 0) {
      headline = `${refillText} due`;
      tone = "warning";
    } else {
      headline = `${headline} · ${refillText}`;
    }
  }

  const progress = glance.checkProgress;
  const emptyHint =
    tone !== "success"
      ? undefined
      : progress && progress.total > 0
        ? `${progress.done} of ${progress.total} checks done today.`
        : "No doses pending today.";

  return {
    key: "health",
    label: "Health",
    href: "/health",
    headline,
    tone,
    items: [
      ...pending.slice(0, 3).map((d) => ({
        key: d.key,
        label: d.label,
        meta: [isLate(d) ? "Overdue" : d.scheduledTimeLabel, d.metaExtra, d.awaitingFirst ? "Start" : null]
          .filter(Boolean)
          .join(" · "),
        href: d.href,
      })),
      ...refills.slice(0, Math.max(0, 3 - pending.length)).map((r) => ({
        key: `refill:${r.medicationId}`,
        label: doseLabel({ name: `Refill ${r.name}`, memberLabel: r.memberLabel, isSelf: r.isSelf }),
        meta: `${r.overdue ? "Overdue" : "Due"} · runs out ${formatDay(r.runsOutOn)}`,
        href: `/health?supply=${encodeURIComponent(r.medicationId)}`,
      })),
    ],
    overflowCount: Math.max(0, pending.length - 3) + Math.max(0, refills.length - Math.max(0, 3 - pending.length)),
    emptyHint,
  };
}
