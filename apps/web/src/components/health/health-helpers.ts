/**
 * Pure helper functions for the Health module's UI — extracted out of the HealthPageClient.tsx
 * monolith (2026-08-30) alongside health-types.ts. No JSX, no hooks; safe to import from any
 * health/* component without pulling in the rest of the Today-tab rendering.
 */
import type { NoteShareMember } from "../NoteSharePicker";
import {
  DEFAULT_VITALS_METRICS,
  VITALS_METRICS,
  emptyExerciseDetailDraft,
  PAIN_BODY_REGION_LABELS,
  type ExerciseDetail,
  type ExerciseDetailDraft,
  type FoodLogEntry,
  type FoodLogEntryDraft,
  type HealthEvent,
  type HealthMedication,
  type LoggedDose,
  type PainLog,
  type PainLogDraft,
  type PendingDose,
  type PendingGroupDose,
  type TodayEntry,
  type VitalsMetric,
  type VitalsReading,
  type VitalsReadingDraft,
} from "./health-types";

export function scheduleKindLabel(kind: HealthMedication["scheduleKind"]): string {
  if (kind === "prn") return "PRN";
  if (kind === "interval") return "Every…";
  return "Scheduled";
}

export function groupPendingDosesByMemberThenTime(doses: PendingDose[]): Array<{
  memberId: string;
  times: Array<{ scheduledTime: string; label: string; doses: PendingDose[] }>;
}> {
  const byMember = new Map<string, PendingDose[]>();
  for (const dose of doses) {
    const list = byMember.get(dose.memberId) ?? [];
    list.push(dose);
    byMember.set(dose.memberId, list);
  }
  return [...byMember.entries()].map(([memberId, memberDoses]) => {
    const byTime = new Map<string, PendingDose[]>();
    for (const dose of memberDoses) {
      const key = dose.scheduledTime;
      const list = byTime.get(key) ?? [];
      list.push(dose);
      byTime.set(key, list);
    }
    const times = [...byTime.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([scheduledTime, timeDoses]) => ({
        scheduledTime,
        label: timeDoses[0]?.scheduledTimeLabel || scheduledTime,
        doses: timeDoses,
      }));
    return { memberId, times };
  });
}

export function groupMedsByMember(meds: HealthMedication[]): Array<{
  memberId: string;
  meds: HealthMedication[];
}> {
  const byMember = new Map<string, HealthMedication[]>();
  for (const med of meds) {
    const list = byMember.get(med.memberId) ?? [];
    list.push(med);
    byMember.set(med.memberId, list);
  }
  return [...byMember.entries()].map(([memberId, list]) => ({ memberId, meds: list }));
}

/** "Logged today" doses grouped by person, same shape as groupMedsByMember. */
export function groupLoggedDosesByMember(doses: LoggedDose[]): Array<{
  memberId: string;
  doses: LoggedDose[];
}> {
  const byMember = new Map<string, LoggedDose[]>();
  for (const dose of doses) {
    const list = byMember.get(dose.memberId) ?? [];
    list.push(dose);
    byMember.set(dose.memberId, list);
  }
  return [...byMember.entries()].map(([memberId, list]) => ({ memberId, doses: list }));
}

export function groupPendingGroupDosesByMember(doses: PendingGroupDose[]): Map<string, PendingGroupDose[]> {
  const map = new Map<string, PendingGroupDose[]>();
  for (const dose of doses) {
    const list = map.get(dose.memberId) ?? [];
    list.push(dose);
    map.set(dose.memberId, list);
  }
  return map;
}

/** Real persisted groups (pendingGroupDoses) and ad-hoc same-time-string doses (pendingDoses,
 *  unchanged logic) interleaved by time within one member's section — matches how someone
 *  actually thinks about "what's due at 8am" rather than showing all groups before everything
 *  else. */
export function mergeTodayEntriesForMember(
  adhocTimes: Array<{ scheduledTime: string; label: string; doses: PendingDose[] }>,
  groupDoses: PendingGroupDose[],
): TodayEntry[] {
  const entries: TodayEntry[] = [
    ...adhocTimes.map((t) => ({ kind: "adhoc" as const, scheduledTime: t.scheduledTime, timeGroup: t })),
    ...groupDoses.map((g) => ({ kind: "group" as const, scheduledTime: g.scheduledTime, group: g })),
  ];
  return entries.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}

export function vitalsMetricLabel(metric: string): string {
  return VITALS_METRICS.find((m) => m.value === metric)?.label ?? metric;
}

export function formatReadingsSummary(readings: VitalsReading[] | undefined): string | null {
  if (!readings || readings.length === 0) return null;
  return readings.map((r) => `${vitalsMetricLabel(r.metric)}: ${r.value} ${r.unit}`).join(", ");
}

export function formatExerciseSummary(details: ExerciseDetail[] | undefined): string | null {
  if (!details || details.length === 0) return null;
  return details
    .map((d) => (d.durationMinutes != null ? `${d.activity} (${d.durationMinutes} min)` : d.activity))
    .join(", ");
}

export function formatPainSummary(logs: PainLog[] | undefined): string | null {
  if (!logs || logs.length === 0) return null;
  return logs
    .map((l) => `${PAIN_BODY_REGION_LABELS[l.bodyRegion]}: ${l.severity}/10`)
    .join(", ");
}

export function formatFoodLogSummary(entries: FoodLogEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;
  return entries.map((e) => e.foodName).join(", ");
}

/** Short, human title for a meal event when the user hasn't typed one — "Chicken, Rice". */
export function defaultMealTitle(drafts: FoodLogEntryDraft[]): string {
  const names = drafts.map((d) => d.foodName.trim()).filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Meal";
}

/** Short, human title for a vitals event when the user hasn't typed one — "Weight, Heart rate". */
export function defaultVitalsTitle(drafts: VitalsReadingDraft[]): string {
  const labels = drafts.filter((d) => d.value.trim()).map((d) => vitalsMetricLabel(d.metric));
  return labels.length > 0 ? labels.join(", ") : "Vitals";
}

export function draftsToReadings(drafts: VitalsReadingDraft[]): { metric: VitalsMetric; value: number; unit: string }[] {
  return drafts
    .filter((d) => d.value.trim() && d.unit.trim() && Number.isFinite(Number(d.value)))
    .map((d) => ({ metric: d.metric, value: Number(d.value), unit: d.unit.trim() }));
}

export function defaultUnitFor(metric: VitalsMetric): string {
  return VITALS_METRICS.find((m) => m.value === metric)?.defaultUnit ?? "";
}

let vitalsDraftKey = 0;
export function nextVitalsDraftKey(): string {
  vitalsDraftKey += 1;
  return `draft-${vitalsDraftKey}`;
}

export function readingsToDrafts(readings: VitalsReading[] | undefined): VitalsReadingDraft[] {
  if (!readings || readings.length === 0) {
    return DEFAULT_VITALS_METRICS.map((metric) => ({
      key: nextVitalsDraftKey(),
      metric,
      value: "",
      unit: defaultUnitFor(metric),
    }));
  }
  return readings.map((r) => ({
    key: nextVitalsDraftKey(),
    metric: r.metric,
    value: String(r.value),
    unit: r.unit,
  }));
}

export function exerciseDetailToDraft(detail: ExerciseDetail | undefined): ExerciseDetailDraft {
  if (!detail) return emptyExerciseDetailDraft();
  return {
    activity: detail.activity,
    durationMinutes: detail.durationMinutes != null ? String(detail.durationMinutes) : "",
    intensity: detail.intensity ?? "",
    distance: detail.distance != null ? String(detail.distance) : "",
    distanceUnit: detail.distanceUnit ?? "",
    sets: detail.sets != null ? String(detail.sets) : "",
    reps: detail.reps != null ? String(detail.reps) : "",
    caloriesEstimated: detail.caloriesEstimated != null ? String(detail.caloriesEstimated) : "",
  };
}

/** Empty activity name means "nothing to save" — the exercise editor is optional in the sheet. */
function draftNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function painLogsToDrafts(logs: PainLog[] | undefined): PainLogDraft[] {
  if (!logs) return [];
  return logs.map((l) => ({
    key: nextPainDraftKey(),
    region: l.bodyRegion,
    severity: l.severity,
    qualityTags: l.qualityTags,
  }));
}

export function draftsToPainLogs(drafts: PainLogDraft[]): PainLog[] {
  return drafts.map((d) => ({ bodyRegion: d.region, severity: d.severity, qualityTags: d.qualityTags }));
}

let foodDraftKey = 0;
export function nextFoodDraftKey(): string {
  foodDraftKey += 1;
  return `food-draft-${foodDraftKey}`;
}

function emptyFoodLogEntryDraft(): FoodLogEntryDraft {
  return {
    key: nextFoodDraftKey(),
    foodName: "",
    quantity: "",
    unit: "",
    calories: "",
    proteinG: "",
    carbsG: "",
    fatG: "",
  };
}

export function foodLogEntriesToDrafts(entries: FoodLogEntry[] | undefined): FoodLogEntryDraft[] {
  if (!entries || entries.length === 0) return [emptyFoodLogEntryDraft()];
  return entries.map((e) => ({
    key: nextFoodDraftKey(),
    foodName: e.foodName,
    quantity: e.quantity != null ? String(e.quantity) : "",
    unit: e.unit,
    calories: e.calories != null ? String(e.calories) : "",
    proteinG: e.proteinG != null ? String(e.proteinG) : "",
    carbsG: e.carbsG != null ? String(e.carbsG) : "",
    fatG: e.fatG != null ? String(e.fatG) : "",
  }));
}

export function newFoodLogEntryDraft(): FoodLogEntryDraft {
  return emptyFoodLogEntryDraft();
}

export function draftsToFoodLogEntries(drafts: FoodLogEntryDraft[]): FoodLogEntry[] {
  return drafts
    .filter(
      (d) =>
        d.foodName.trim() &&
        d.unit.trim() &&
        d.quantity.trim() &&
        Number.isFinite(Number(d.quantity)),
    )
    .map((d) => ({
      foodName: d.foodName.trim(),
      quantity: Number(d.quantity),
      unit: d.unit.trim(),
      calories: draftNumberOrNull(d.calories),
      proteinG: draftNumberOrNull(d.proteinG),
      carbsG: draftNumberOrNull(d.carbsG),
      fatG: draftNumberOrNull(d.fatG),
    }));
}

export function draftToExerciseDetailInput(draft: ExerciseDetailDraft): ExerciseDetail | null {
  if (!draft.activity.trim()) return null;
  return {
    activity: draft.activity.trim(),
    durationMinutes: draftNumberOrNull(draft.durationMinutes),
    intensity: draft.intensity.trim() || null,
    distance: draftNumberOrNull(draft.distance),
    distanceUnit: draft.distanceUnit.trim() || null,
    sets: draftNumberOrNull(draft.sets),
    reps: draftNumberOrNull(draft.reps),
    caloriesEstimated: draftNumberOrNull(draft.caloriesEstimated),
  };
}

let painDraftKey = 0;
export function nextPainDraftKey(): string {
  painDraftKey += 1;
  return `pain-draft-${painDraftKey}`;
}

/** Mild/moderate/severe buckets on the existing success/warning/danger tokens — no new palette. */
export function painSeverityColor(severity: number): string {
  if (severity <= 3) return "var(--color-success)";
  if (severity <= 6) return "var(--color-warning)";
  return "var(--color-danger)";
}

export function memberLabel(members: NoteShareMember[], memberId: string): string {
  return members.find((m) => m.memberId === memberId)?.label ?? "Member";
}

export function resolveDefaultMemberId(currentMemberId: string, members: NoteShareMember[]): string {
  if (currentMemberId && members.some((m) => m.memberId === currentMemberId)) {
    return currentMemberId;
  }
  return members[0]?.memberId ?? "";
}

export function todayInTz(timeZone: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function formatEventWhen(ev: HealthEvent): string | null {
  if (ev.startDate) {
    const [y, m, d] = ev.startDate.split("-").map(Number);
    if (y && m && d) {
      const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      if (ev.startTime) {
        const [hh, mm] = ev.startTime.split(":").map(Number);
        if (Number.isFinite(hh) && Number.isFinite(mm)) {
          const timeLabel = new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          });
          return `${dateLabel} · ${timeLabel}`;
        }
      }
      return dateLabel;
    }
  }
  if (ev.startedAt) {
    const at = new Date(ev.startedAt);
    if (!Number.isNaN(at.getTime())) {
      return at.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  return null;
}
