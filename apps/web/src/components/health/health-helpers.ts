/**
 * Pure helper functions for the Health module's UI — extracted out of the HealthPageClient.tsx
 * monolith (2026-08-30) alongside health-types.ts. No JSX, no hooks; safe to import from any
 * health/* component without pulling in the rest of the Today-tab rendering.
 */
import type { NoteShareMember } from "../NoteSharePicker";
import {
  DEFAULT_VITALS_METRICS,
  VITALS_METRICS,
  type HealthEvent,
  type HealthMedication,
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
