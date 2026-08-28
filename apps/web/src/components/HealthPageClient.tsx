"use client";

import { Heart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteShareMember } from "./NoteSharePicker";
import { NoteSharePicker } from "./NoteSharePicker";
import type { HealthAclGrants } from "./HealthPeopleAccessPanel";
import { ModuleReportsLink } from "./reports/ModuleReportsLink";
import {
  MedScheduleEditor,
  medicationToScheduleDraft,
  scheduleDraftToRequestBody,
  type MedScheduleDraft,
} from "./health/MedScheduleEditor";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  EmptyState,
  Input,
  LinkButton,
  ListItem,
  SectionHeader,
  Select,
  Sheet,
  Textarea,
} from "./ui";

export type HealthEventType =
  | "sickness"
  | "injury"
  | "appointment"
  | "symptom"
  | "medication"
  | "vitals"
  | "other";

export type VitalsMetric =
  | "weight"
  | "height"
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "heart_rate"
  | "temperature"
  | "blood_oxygen"
  | "blood_glucose"
  | "respiratory_rate"
  | "other";

export interface VitalsReading {
  id?: string;
  metric: VitalsMetric;
  value: number;
  unit: string;
}

export interface HealthEvent {
  id: string;
  memberId: string;
  medicationId: string | null;
  type: HealthEventType;
  title: string;
  notes: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationKind?: "single_day" | "ongoing";
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  visibility: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  canEdit?: boolean;
  readings?: VitalsReading[];
}

export interface HealthMedication {
  id: string;
  memberId: string;
  /** Groups this medication belongs to — many-to-many (a med taken multiple times a day can
   *  have different doses in different groups), so this is an array, not a single id. */
  groupIds?: string[];
  name: string;
  dosage: string | null;
  instructions: string | null;
  scheduleKind: "scheduled" | "prn" | "interval";
  schedule: {
    times?: string[];
    daysOfWeek?: number[];
    everyMinutes?: number;
    anchor?: string;
    fixedStartTime?: string;
    intervalFrom?: string;
    stop?: { mode?: string; maxDoses?: number; endTime?: string };
  };
  reminderOffsets: number[];
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
  visibility: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  sharedWithMe?: boolean;
  canEdit?: boolean;
  canLog?: boolean;
}

interface PendingDose {
  medicationId: string;
  name: string;
  dosage?: string | null;
  scheduledAt: string;
  scheduledTime: string;
  scheduledTimeLabel: string;
  memberId: string;
  awaitingFirst?: boolean;
}

/** Minimal shape HealthMedicationSheet's group picker needs — full MedicationGroup type lives
 *  in components/health/MedicationManagerClient.tsx, this avoids a circular import. */
export interface MedicationGroupOption {
  id: string;
  memberId: string;
  name: string;
}

interface PendingGroupDose {
  groupId: string;
  name: string;
  scheduledAt: string;
  scheduledTime: string;
  scheduledTimeLabel: string;
  memberId: string;
  medications: { medicationId: string; name: string; dosage: string | null; alreadyLogged: boolean }[];
}

function scheduleKindLabel(kind: HealthMedication["scheduleKind"]): string {
  if (kind === "prn") return "PRN";
  if (kind === "interval") return "Every…";
  return "Scheduled";
}

function groupPendingDosesByMemberThenTime(doses: PendingDose[]): Array<{
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

function groupMedsByMember(meds: HealthMedication[]): Array<{
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

function groupPendingGroupDosesByMember(doses: PendingGroupDose[]): Map<string, PendingGroupDose[]> {
  const map = new Map<string, PendingGroupDose[]>();
  for (const dose of doses) {
    const list = map.get(dose.memberId) ?? [];
    list.push(dose);
    map.set(dose.memberId, list);
  }
  return map;
}

type TodayEntry =
  | { kind: "adhoc"; scheduledTime: string; timeGroup: { scheduledTime: string; label: string; doses: PendingDose[] } }
  | { kind: "group"; scheduledTime: string; group: PendingGroupDose };

/** Real persisted groups (pendingGroupDoses) and ad-hoc same-time-string doses (pendingDoses,
 *  unchanged logic) interleaved by time within one member's section — matches how someone
 *  actually thinks about "what's due at 8am" rather than showing all groups before everything
 *  else. */
function mergeTodayEntriesForMember(
  adhocTimes: Array<{ scheduledTime: string; label: string; doses: PendingDose[] }>,
  groupDoses: PendingGroupDose[],
): TodayEntry[] {
  const entries: TodayEntry[] = [
    ...adhocTimes.map((t) => ({ kind: "adhoc" as const, scheduledTime: t.scheduledTime, timeGroup: t })),
    ...groupDoses.map((g) => ({ kind: "group" as const, scheduledTime: g.scheduledTime, group: g })),
  ];
  return entries.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}

const EVENT_TYPES: { value: HealthEventType; label: string }[] = [
  { value: "sickness", label: "Sickness" },
  { value: "injury", label: "Injury" },
  { value: "appointment", label: "Appointment" },
  { value: "symptom", label: "Symptom" },
  { value: "medication", label: "Medication" },
  { value: "vitals", label: "Vitals" },
  { value: "other", label: "Other" },
];

const VITALS_METRICS: { value: VitalsMetric; label: string; defaultUnit: string }[] = [
  { value: "weight", label: "Weight", defaultUnit: "lb" },
  { value: "height", label: "Height", defaultUnit: "in" },
  { value: "blood_pressure_systolic", label: "BP systolic", defaultUnit: "mmHg" },
  { value: "blood_pressure_diastolic", label: "BP diastolic", defaultUnit: "mmHg" },
  { value: "heart_rate", label: "Heart rate", defaultUnit: "bpm" },
  { value: "temperature", label: "Temperature", defaultUnit: "°F" },
  { value: "blood_oxygen", label: "Blood oxygen", defaultUnit: "%" },
  { value: "blood_glucose", label: "Blood glucose", defaultUnit: "mg/dL" },
  { value: "respiratory_rate", label: "Respiratory rate", defaultUnit: "breaths/min" },
  { value: "other", label: "Other", defaultUnit: "" },
];

function vitalsMetricLabel(metric: string): string {
  return VITALS_METRICS.find((m) => m.value === metric)?.label ?? metric;
}

function formatReadingsSummary(readings: VitalsReading[] | undefined): string | null {
  if (!readings || readings.length === 0) return null;
  return readings.map((r) => `${vitalsMetricLabel(r.metric)}: ${r.value} ${r.unit}`).join(", ");
}

/** Short, human title for a vitals event when the user hasn't typed one — "Weight, Heart rate". */
function defaultVitalsTitle(drafts: VitalsReadingDraft[]): string {
  const labels = drafts.filter((d) => d.value.trim()).map((d) => vitalsMetricLabel(d.metric));
  return labels.length > 0 ? labels.join(", ") : "Vitals";
}

function draftsToReadings(drafts: VitalsReadingDraft[]): { metric: VitalsMetric; value: number; unit: string }[] {
  return drafts
    .filter((d) => d.value.trim() && d.unit.trim() && Number.isFinite(Number(d.value)))
    .map((d) => ({ metric: d.metric, value: Number(d.value), unit: d.unit.trim() }));
}

function defaultUnitFor(metric: VitalsMetric): string {
  return VITALS_METRICS.find((m) => m.value === metric)?.defaultUnit ?? "";
}

let vitalsDraftKey = 0;
function nextVitalsDraftKey(): string {
  vitalsDraftKey += 1;
  return `draft-${vitalsDraftKey}`;
}

type VitalsReadingDraft = { key: string; metric: VitalsMetric; value: string; unit: string };

/** Most-logged vitals, pre-filled empty so the common case is just typing numbers. */
const DEFAULT_VITALS_METRICS: VitalsMetric[] = [
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "heart_rate",
  "temperature",
];

function readingsToDrafts(readings: VitalsReading[] | undefined): VitalsReadingDraft[] {
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

function VitalsReadingsEditor({
  drafts,
  onChange,
}: {
  drafts: VitalsReadingDraft[];
  onChange: (drafts: VitalsReadingDraft[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm">Readings</span>
      <div className="space-y-2">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
          >
            <label className="block space-y-1 text-xs">
              <span className="text-[var(--color-text-muted)]">Metric</span>
              <Select
                value={draft.metric}
                onChange={(e) => {
                  const metric = e.target.value as VitalsMetric;
                  onChange(
                    drafts.map((d) =>
                      d.key === draft.key ? { ...d, metric, unit: defaultUnitFor(metric) } : d,
                    ),
                  );
                }}
              >
                {VITALS_METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Value</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.value}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, value } : d)));
                  }}
                />
              </label>
              <label className="w-20 space-y-1 text-xs">
                <span className="text-[var(--color-text-muted)]">Unit</span>
                <Input
                  value={draft.unit}
                  onChange={(e) => {
                    const unit = e.target.value;
                    onChange(drafts.map((d) => (d.key === draft.key ? { ...d, unit } : d)));
                  }}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([
            ...drafts,
            { key: nextVitalsDraftKey(), metric: "weight", value: "", unit: defaultUnitFor("weight") },
          ])
        }
      >
        Add reading
      </Button>
    </div>
  );
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

function todayInTz(timeZone: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatEventWhen(ev: HealthEvent): string | null {
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

function HealthRow({
  title,
  subtitle,
  trailing,
  onClick,
  highlighted,
  rowRef,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  highlighted?: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={rowRef}>
      <ListItem
        as={onClick ? "button" : "div"}
        onClick={onClick}
        className={
          highlighted
            ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]"
            : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="min-w-0 text-left">
            <p className="truncate font-medium text-[var(--color-text)]">{title}</p>
            {subtitle ? (
              <p className="truncate text-sm text-[var(--color-text-muted)]">{subtitle}</p>
            ) : null}
          </div>
          {trailing}
        </div>
      </ListItem>
    </div>
  );
}

function MedGroupDoseCard({
  group,
  canLog,
  expanded,
  onToggleExpand,
  onTakeAll,
  takingAll,
  onLogOne,
  highlightTakeKey,
  highlightTakeRef,
}: {
  group: PendingGroupDose;
  canLog: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onTakeAll: () => void;
  takingAll: boolean;
  onLogOne: (medicationId: string, status?: "skipped") => void;
  highlightTakeKey: string | null;
  highlightTakeRef: React.Ref<HTMLDivElement>;
}) {
  const pendingCount = group.medications.filter((m) => !m.alreadyLogged).length;
  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{group.name}</p>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            {group.scheduledTimeLabel} · {group.medications.length} meds
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canLog && pendingCount > 1 ? (
            <Button size="sm" disabled={takingAll} onClick={onTakeAll}>
              {takingAll ? "Saving…" : "Take all"}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onToggleExpand}>
            {expanded ? "Hide" : "Show"} meds
          </Button>
        </div>
      </div>
      {expanded ? (
        <ul className="space-y-2 pt-1">
          {group.medications.map((med) => {
            const doseKey = `${med.medicationId}-${group.scheduledAt}`;
            const highlighted = highlightTakeKey === doseKey || highlightTakeKey === med.medicationId;
            return (
              <HealthRow
                key={med.medicationId}
                rowRef={highlighted ? highlightTakeRef : undefined}
                highlighted={highlighted}
                title={med.name}
                subtitle={med.dosage?.trim() || undefined}
                trailing={
                  med.alreadyLogged ? (
                    <Badge tone="success">Logged</Badge>
                  ) : canLog ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => onLogOne(med.medicationId)}>
                        Taken
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onLogOne(med.medicationId, "skipped")}>
                        Skip
                      </Button>
                    </div>
                  ) : null
                }
              />
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function HealthPageClient({
  members,
  currentMemberId,
  householdTimezone,
  initialEventId,
  initialMedicationId,
  initialTakeMedicationId,
  initialTakeScheduledAt,
  pushAction,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  householdTimezone: string;
  initialEventId?: string;
  initialMedicationId?: string;
  /** Dashboard / calendar dose deep-link → Today Taken (WHO-239). */
  initialTakeMedicationId?: string;
  initialTakeScheduledAt?: string;
  /** iOS / no-actions deep-link auto-log (WHO-235). */
  pushAction?: {
    medicationId: string;
    action: string;
    scheduledAt: string;
    token: string;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"today" | "events" | "medications">("today");
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [medications, setMedications] = useState<HealthMedication[]>([]);
  const [groups, setGroups] = useState<MedicationGroupOption[]>([]);
  const [pendingDoses, setPendingDoses] = useState<PendingDose[]>([]);
  const [pendingGroupDoses, setPendingGroupDoses] = useState<PendingGroupDose[]>([]);
  const [prnMeds, setPrnMeds] = useState<HealthMedication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushActionNotice, setPushActionNotice] = useState<string | null>(null);
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [vitalsSheetOpen, setVitalsSheetOpen] = useState(false);
  const [medSheetOpen, setMedSheetOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<HealthEvent | null>(null);
  const [editingMed, setEditingMed] = useState<HealthMedication | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, HealthAclGrants>>({});
  const [loggingAllKey, setLoggingAllKey] = useState<string | null>(null);
  const [expandedGroupDoses, setExpandedGroupDoses] = useState<Set<string>>(new Set());
  const [highlightTakeKey, setHighlightTakeKey] = useState<string | null>(null);
  const pushActionHandled = useRef(false);
  const takeHandled = useRef(false);
  const highlightTakeRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, medsRes, groupsRes, glanceRes, capsRes] = await Promise.all([
        apiClient.get<{ events: HealthEvent[] }>("/api/health/events"),
        apiClient.get<{ medications: HealthMedication[] }>("/api/health/medications"),
        apiClient.get<{ groups: MedicationGroupOption[] }>("/api/health/medication-groups"),
        apiClient.get<{
          pendingDoses: PendingDose[];
          pendingGroupDoses: PendingGroupDose[];
          prnMedications: HealthMedication[];
        }>("/api/health/glance"),
        apiClient.get<{ bySubject: Record<string, HealthAclGrants> }>("/api/health/capabilities"),
      ]);
      setEvents(eventsRes.events);
      setMedications(medsRes.medications);
      setGroups(groupsRes.groups ?? []);
      setPendingDoses(glanceRes.pendingDoses);
      setPendingGroupDoses(glanceRes.pendingGroupDoses ?? []);
      setPrnMeds(glanceRes.prnMedications);
      setCapabilities(capsRes.bySubject ?? {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load health data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!initialEventId) return;
    const ev = events.find((e) => e.id === initialEventId);
    if (ev) {
      setEditingEvent(ev);
      setEventSheetOpen(true);
      setTab("events");
      return;
    }
    if (loading) return;
    void apiClient
      .get<{ event: HealthEvent }>(`/api/health/events/${initialEventId}`)
      .then((res) => {
        setEditingEvent(res.event);
        setEventSheetOpen(true);
        setTab("events");
      })
      .catch(() => {
        setError("Could not open that health event.");
      });
  }, [initialEventId, events, loading]);

  useEffect(() => {
    if (!initialMedicationId || pushAction || initialTakeMedicationId) return;
    const med = medications.find((m) => m.id === initialMedicationId);
    if (med) {
      setEditingMed(med);
      setMedSheetOpen(true);
      setTab("medications");
    }
  }, [initialMedicationId, medications, pushAction, initialTakeMedicationId]);

  useEffect(() => {
    if (!initialTakeMedicationId || pushAction || takeHandled.current) return;
    if (loading) return;
    takeHandled.current = true;
    setTab("today");
    const key = initialTakeScheduledAt
      ? `${initialTakeMedicationId}-${initialTakeScheduledAt}`
      : initialTakeMedicationId;
    setHighlightTakeKey(key);
    router.replace("/health");
  }, [initialTakeMedicationId, initialTakeScheduledAt, pushAction, loading, router]);

  useEffect(() => {
    if (!highlightTakeKey || tab !== "today") return;
    highlightTakeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightTakeKey, tab, pendingDoses]);

  useEffect(() => {
    if (!pushAction || pushActionHandled.current) return;
    pushActionHandled.current = true;
    const status =
      pushAction.action === "skip" || pushAction.action === "skipped" ? "skipped" : "taken";
    void (async () => {
      try {
        await apiClient.post("/api/health/medications/push-action", {
          token: pushAction.token,
          action: status,
        });
        setPushActionNotice(status === "skipped" ? "Dose marked skipped." : "Dose marked taken.");
        setTab("today");
        await load();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? "Could not log dose from notification (link may have expired)."
            : "Could not log dose from notification",
        );
      } finally {
        router.replace("/health");
      }
    })();
  }, [pushAction, load, router]);

  async function logDose(
    medicationId: string,
    opts: { scheduledAt?: string; alsoCreateEvent?: boolean; status?: string },
    options?: { reload?: boolean },
  ): Promise<boolean> {
    try {
      await apiClient.post(`/api/health/medications/${medicationId}/log`, opts);
      if (options?.reload !== false) await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log dose");
      return false;
    }
  }

  async function logAllTaken(groupKey: string, doses: PendingDose[]) {
    const actionable = doses.filter((d) => canLogForMember(d.memberId));
    if (actionable.length === 0 || loggingAllKey) return;
    setError(null);
    setLoggingAllKey(groupKey);
    try {
      for (const dose of actionable) {
        const ok = await logDose(
          dose.medicationId,
          { scheduledAt: dose.scheduledAt, alsoCreateEvent: false },
          { reload: false },
        );
        if (!ok) break;
      }
      await load();
    } finally {
      setLoggingAllKey(null);
    }
  }

  /** Persisted-group "Take all" — one batch request to /medication-groups/:id/log-all, unlike
   *  the ad-hoc logAllTaken above which still loops N individual requests client-side. */
  async function logGroupAllTaken(group: PendingGroupDose) {
    const key = `group:${group.groupId}:${group.scheduledAt}`;
    if (loggingAllKey) return;
    setError(null);
    setLoggingAllKey(key);
    try {
      await apiClient.post(`/api/health/medication-groups/${group.groupId}/log-all`, {
        scheduledAt: group.scheduledAt,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log group doses");
    } finally {
      setLoggingAllKey(null);
    }
  }

  function toggleGroupDoseExpanded(key: string) {
    setExpandedGroupDoses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const canAddEvent = members.some((m) => capabilities[m.memberId]?.events === "write");
  const canAddMed = members.some((m) => capabilities[m.memberId]?.medications === "write");

  function canLogForMember(memberId: string) {
    return capabilities[memberId]?.doses === "write";
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {pushActionNotice ? <Alert variant="success">{pushActionNotice}</Alert> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
        {(["today", "events", "medications"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {key === "today" ? "Today" : key === "events" ? "Events" : "Medications"}
          </Button>
        ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/health/sharing" size="sm" variant="secondary">
            Sharing
          </LinkButton>
          <ModuleReportsLink module="health" />
        </div>
      </div>

      {tab === "today" ? (
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-4">
              <SectionHeader title="Scheduled doses" />
              {loading ? (
                <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
              ) : pendingDoses.length === 0 && pendingGroupDoses.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No pending doses today.</p>
              ) : (
                (() => {
                  const adhocByMember = groupPendingDosesByMemberThenTime(pendingDoses);
                  const groupByMember = groupPendingGroupDosesByMember(pendingGroupDoses);
                  const memberIds = [
                    ...new Set([...adhocByMember.map((m) => m.memberId), ...groupByMember.keys()]),
                  ];
                  return memberIds.map((memberId) => {
                    const adhocTimes = adhocByMember.find((m) => m.memberId === memberId)?.times ?? [];
                    const groupDoses = groupByMember.get(memberId) ?? [];
                    const merged = mergeTodayEntriesForMember(adhocTimes, groupDoses);
                    return (
                      <div key={memberId} className="space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">
                          {memberLabel(members, memberId)}
                        </h3>
                        {merged.map((entry) => {
                          if (entry.kind === "group") {
                            const group = entry.group;
                            const doseKey = `group:${group.groupId}:${group.scheduledAt}`;
                            return (
                              <MedGroupDoseCard
                                key={doseKey}
                                group={group}
                                canLog={canLogForMember(group.memberId)}
                                expanded={expandedGroupDoses.has(doseKey)}
                                onToggleExpand={() => toggleGroupDoseExpanded(doseKey)}
                                onTakeAll={() => void logGroupAllTaken(group)}
                                takingAll={loggingAllKey === `group:${group.groupId}:${group.scheduledAt}`}
                                onLogOne={(medicationId, status) =>
                                  void logDose(medicationId, {
                                    scheduledAt: group.scheduledAt,
                                    alsoCreateEvent: false,
                                    status,
                                  })
                                }
                                highlightTakeKey={highlightTakeKey}
                                highlightTakeRef={highlightTakeRef}
                              />
                            );
                          }
                          const timeGroup = entry.timeGroup;
                          const loggable = timeGroup.doses.filter((d) => canLogForMember(d.memberId));
                          const groupKey = `${memberId}:${timeGroup.scheduledTime}`;
                          return (
                            <div key={timeGroup.scheduledTime} className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                                  {timeGroup.label}
                                  {timeGroup.doses.length > 1
                                    ? ` · ${timeGroup.doses.length} meds`
                                    : null}
                                </p>
                                {loggable.length > 1 ? (
                                  <Button
                                    size="sm"
                                    disabled={loggingAllKey !== null}
                                    onClick={() => void logAllTaken(groupKey, loggable)}
                                  >
                                    {loggingAllKey === groupKey ? "Saving…" : "Taken all"}
                                  </Button>
                                ) : null}
                              </div>
                              <ul className="space-y-2">
                                {timeGroup.doses.map((dose) => {
                                  const doseKey = `${dose.medicationId}-${dose.scheduledAt}`;
                                  const highlighted =
                                    highlightTakeKey === doseKey ||
                                    highlightTakeKey === dose.medicationId;
                                  return (
                                    <HealthRow
                                      key={doseKey}
                                      rowRef={highlighted ? highlightTakeRef : undefined}
                                      highlighted={highlighted}
                                      title={dose.name}
                                      subtitle={dose.dosage?.trim() || undefined}
                                      trailing={
                                        canLogForMember(dose.memberId) ? (
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              onClick={() =>
                                                void logDose(dose.medicationId, {
                                                  scheduledAt: dose.scheduledAt,
                                                  alsoCreateEvent: false,
                                                })
                                              }
                                            >
                                              {dose.awaitingFirst ? "Start" : "Taken"}
                                            </Button>
                                            {!dose.awaitingFirst ? (
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() =>
                                                  void logDose(dose.medicationId, {
                                                    scheduledAt: dose.scheduledAt,
                                                    status: "skipped",
                                                  })
                                                }
                                              >
                                                Skip
                                              </Button>
                                            ) : null}
                                          </div>
                                        ) : null
                                      }
                                    />
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <SectionHeader title="As needed (PRN)" />
              {prnMeds.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No as-needed meds.</p>
              ) : (
                groupMedsByMember(prnMeds).map((memberGroup) => (
                  <div key={memberGroup.memberId} className="space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--color-text)]">
                      {memberLabel(members, memberGroup.memberId)}
                    </h3>
                    <ul className="space-y-2">
                      {memberGroup.meds.map((med) => (
                        <HealthRow
                          key={med.id}
                          title={med.name}
                          subtitle={med.dosage?.trim() || "As needed"}
                          trailing={
                            (med.canLog ?? canLogForMember(med.memberId)) ? (
                              <Button size="sm" onClick={() => void logDose(med.id, {})}>
                                Log dose
                              </Button>
                            ) : null
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="space-y-4">
          {canAddEvent ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setVitalsSheetOpen(true)}>
              Log vitals
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingEvent(null);
                setEventSheetOpen(true);
              }}
            >
              Add event
            </Button>
          </div>
          ) : null}
          {events.length === 0 && !loading ? (
            <EmptyState
              icon={<Heart className="h-8 w-8" aria-hidden />}
              title="No health events"
              description="Log sickness, injuries, or appointments."
            />
          ) : (
            events.map((ev) => {
              const when = formatEventWhen(ev);
              return (
              <HealthRow
                key={ev.id}
                title={ev.title}
                subtitle={[
                  EVENT_TYPES.find((t) => t.value === ev.type)?.label ?? ev.type,
                  memberLabel(members, ev.memberId),
                  when,
                  ev.durationKind === "ongoing" && !ev.endedAt ? "Ongoing" : null,
                  ev.type === "vitals" ? formatReadingsSummary(ev.readings) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  ev.visibility === "private" ? <Badge tone="default">Private</Badge> : null
                }
                onClick={() => {
                  setEditingEvent(ev);
                  setEventSheetOpen(true);
                }}
              />
              );
            })
          )}
        </div>
      ) : null}

      {tab === "medications" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LinkButton href="/health/medications" size="sm" variant="secondary">
              Open medication manager
            </LinkButton>
            {canAddMed ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditingMed(null);
                  setMedSheetOpen(true);
                }}
              >
                Add medication
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            This list is for quick edits. Use the medication manager to set up reminder groups and see
            everyone&apos;s schedule at a glance.
          </p>
          {medications.length === 0 && !loading ? (
            <EmptyState
              icon={<Heart className="h-8 w-8" aria-hidden />}
              title="No medications"
              description="Add scheduled or PRN medications."
            />
          ) : (
            medications.map((med) => (
              <HealthRow
                key={med.id}
                title={med.name}
                subtitle={`${scheduleKindLabel(med.scheduleKind)} · ${memberLabel(members, med.memberId)}`}
                trailing={
                  <Badge tone={med.enabled ? "accent" : "default"}>
                    {scheduleKindLabel(med.scheduleKind)}
                  </Badge>
                }
                onClick={() => {
                  setEditingMed(med);
                  setMedSheetOpen(true);
                }}
              />
            ))
          )}
        </div>
      ) : null}

      <HealthEventSheet
        open={eventSheetOpen}
        event={editingEvent}
        members={members}
        currentMemberId={currentMemberId}
        householdTimezone={householdTimezone}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.events === "write")
          .map((m) => m.memberId)}
        readOnly={Boolean(editingEvent && editingEvent.canEdit === false)}
        onClose={() => {
          setEventSheetOpen(false);
          setEditingEvent(null);
          router.replace("/health");
        }}
        onSaved={() => {
          setEventSheetOpen(false);
          setEditingEvent(null);
          void load();
        }}
      />

      <LogVitalsSheet
        open={vitalsSheetOpen}
        members={members}
        currentMemberId={currentMemberId}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.events === "write")
          .map((m) => m.memberId)}
        onClose={() => setVitalsSheetOpen(false)}
        onSaved={() => {
          setVitalsSheetOpen(false);
          void load();
        }}
      />

      <HealthMedicationSheet
        open={medSheetOpen}
        medication={editingMed}
        members={members}
        currentMemberId={currentMemberId}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.medications === "write")
          .map((m) => m.memberId)}
        groups={groups}
        readOnly={Boolean(editingMed && editingMed.canEdit === false)}
        onClose={() => {
          setMedSheetOpen(false);
          setEditingMed(null);
          router.replace("/health");
        }}
        onSaved={() => {
          setMedSheetOpen(false);
          setEditingMed(null);
          void load();
        }}
      />

    </div>
  );
}

/**
 * Fast path for the common case — a few numbers, logged right now. No title, no
 * duration/ongoing, no type picker; timestamp is "now" (use "Add event" with type
 * Vitals for backdating). See HealthEventSheet for the full editor.
 */
function LogVitalsSheet({
  open,
  members,
  currentMemberId,
  writableMemberIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  members: NoteShareMember[];
  currentMemberId: string;
  writableMemberIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const memberChoices = members.filter((m) => writableMemberIds.includes(m.memberId));
  const defaultMemberId = resolveDefaultMemberId(
    currentMemberId,
    memberChoices.length > 0 ? memberChoices : members,
  );
  const [memberId, setMemberId] = useState(defaultMemberId);
  const [readingDrafts, setReadingDrafts] = useState<VitalsReadingDraft[]>(() => readingsToDrafts(undefined));
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<"household" | "private">("private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(defaultMemberId);
    setReadingDrafts(readingsToDrafts(undefined));
    setNotes("");
    setVisibility("private");
    setSharedMemberIds([]);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultMemberId]);

  const readings = draftsToReadings(readingDrafts);

  async function save() {
    if (readings.length === 0) {
      setErr("Add at least one reading.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/health/events", {
        memberId,
        type: "vitals",
        title: defaultVitalsTitle(readingDrafts),
        notes: notes.trim() || undefined,
        startedAt: new Date().toISOString(),
        durationKind: "single_day",
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
        readings,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log vitals">
      <fieldset className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {(memberChoices.length > 0 ? memberChoices : members).map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <VitalsReadingsEditor drafts={readingDrafts} onChange={setReadingDrafts} />
        <label className="block space-y-1 text-sm">
          <span>Notes (optional)</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Visibility</span>
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "household" | "private")}
          >
            <option value="private">Private</option>
            <option value="household">Household</option>
          </Select>
        </label>
        {visibility === "private" ? (
          <NoteSharePicker
            members={members}
            currentMemberId={currentMemberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-vitals-share"
            hint="Private by default. Share with selected members so they can read this. You and the subject always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || readings.length === 0}>
            Save
          </Button>
        </div>
      </fieldset>
    </Sheet>
  );
}

function HealthEventSheet({
  open,
  event,
  members,
  currentMemberId,
  householdTimezone,
  writableMemberIds,
  readOnly = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: HealthEvent | null;
  members: NoteShareMember[];
  currentMemberId: string;
  householdTimezone: string;
  writableMemberIds: string[];
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const memberChoices = members.filter((m) => writableMemberIds.includes(m.memberId));
  const defaultMemberId = resolveDefaultMemberId(
    currentMemberId,
    memberChoices.length > 0 ? memberChoices : members,
  );
  const [memberId, setMemberId] = useState(event?.memberId ?? defaultMemberId);
  const [type, setType] = useState<HealthEventType>(event?.type ?? "other");
  const [title, setTitle] = useState(event?.title ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [startDate, setStartDate] = useState(event?.startDate ?? "");
  const [startTime, setStartTime] = useState(event?.startTime ?? "");
  const [hasStartTime, setHasStartTime] = useState(Boolean(event?.startTime));
  const [endDate, setEndDate] = useState(event?.endDate ?? "");
  const [endTime, setEndTime] = useState(event?.endTime ?? "");
  const [hasEndTime, setHasEndTime] = useState(Boolean(event?.endTime));
  const [durationKind, setDurationKind] = useState<"single_day" | "ongoing">(
    event?.durationKind ?? "single_day",
  );
  const [visibility, setVisibility] = useState<"household" | "private">(
    event?.visibility ?? "private",
  );
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>(
    event?.sharedMemberIds ?? [],
  );
  const [readingDrafts, setReadingDrafts] = useState<VitalsReadingDraft[]>(() =>
    readingsToDrafts(event?.readings),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(event?.memberId ?? defaultMemberId);
    setType(event?.type ?? "other");
    setTitle(event?.title ?? "");
    setNotes(event?.notes ?? "");
    setStartDate(event?.startDate ?? (event ? "" : todayInTz(householdTimezone)));
    setStartTime(event?.startTime ?? "");
    setHasStartTime(Boolean(event?.startTime));
    setEndDate(event?.endDate ?? "");
    setEndTime(event?.endTime ?? "");
    setHasEndTime(Boolean(event?.endTime));
    setDurationKind(event?.durationKind ?? "single_day");
    setVisibility(event?.visibility ?? "private");
    setReadingDrafts(readingsToDrafts(event?.readings));
    setSharedMemberIds(event?.sharedMemberIds ?? []);
  }, [open, event, defaultMemberId, householdTimezone]);

  async function save() {
    if (readOnly || !title.trim()) return;
    setBusy(true);
    setErr(null);
    const readings = type === "vitals" ? draftsToReadings(readingDrafts) : undefined;
    const body = {
      memberId,
      type,
      title: title.trim(),
      notes: notes.trim() || undefined,
      startDate: startDate.trim() || null,
      startTime: hasStartTime && startTime ? startTime : null,
      ...(durationKind === "ongoing"
        ? {
            endDate: endDate.trim() || null,
            endTime: hasEndTime && endTime ? endTime : null,
          }
        : {}),
      durationKind,
      visibility,
      sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
      readings,
    };
    try {
      if (event) {
        await apiClient.patch(`/api/health/events/${event.id}`, body);
      } else {
        await apiClient.post("/api/health/events", body);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={readOnly ? "Health event" : event ? "Edit event" : "Add health event"}
    >
      <fieldset className="space-y-4 px-6 py-4" disabled={readOnly}>
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {(memberChoices.length > 0 ? memberChoices : members).map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Type</span>
          <Select value={type} onChange={(e) => setType(e.target.value as HealthEventType)}>
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Title</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Notes</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {type === "vitals" ? (
          <VitalsReadingsEditor drafts={readingDrafts} onChange={setReadingDrafts} />
        ) : null}
        <label className="block space-y-1 text-sm">
          <span>Start date</span>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <Checkbox
          checked={hasStartTime}
          onChange={(e) => {
            setHasStartTime(e.target.checked);
            if (!e.target.checked) setStartTime("");
            else if (!startTime) setStartTime("09:00");
          }}
          label="Include start time"
        />
        {hasStartTime ? (
          <label className="block space-y-1 text-sm">
            <span>Start time</span>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
        ) : null}
        <Checkbox
          checked={durationKind === "ongoing"}
          onChange={(e) => {
            const ongoing = e.target.checked;
            setDurationKind(ongoing ? "ongoing" : "single_day");
            if (!ongoing) {
              setEndDate("");
              setEndTime("");
              setHasEndTime(false);
            }
          }}
          label="Ongoing (may span multiple days)"
        />
        {durationKind === "ongoing" ? (
          <>
            <label className="block space-y-1 text-sm">
              <span>End date (optional if still ongoing)</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <Checkbox
              checked={hasEndTime}
              onChange={(e) => {
                setHasEndTime(e.target.checked);
                if (!e.target.checked) setEndTime("");
                else if (!endTime) setEndTime("23:59");
              }}
              label="Include end time"
            />
            {hasEndTime ? (
              <label className="block space-y-1 text-sm">
                <span>End time</span>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </label>
            ) : null}
          </>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span>Visibility</span>
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "household" | "private")}
          >
            <option value="private">Private</option>
            <option value="household">Household</option>
          </Select>
        </label>
        {visibility === "private" ? (
          <NoteSharePicker
            members={members}
            currentMemberId={currentMemberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-event-share"
            hint="Private by default. Share with selected members so they can read this event. You and the subject always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly ? null : (
          <Button onClick={() => void save()} disabled={busy || !title.trim()}>
            Save
          </Button>
          )}
        </div>
      </fieldset>
    </Sheet>
  );
}

export function HealthMedicationSheet({
  open,
  medication,
  members,
  currentMemberId,
  writableMemberIds,
  groups = [],
  readOnly = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  medication: HealthMedication | null;
  members: NoteShareMember[];
  currentMemberId: string;
  writableMemberIds: string[];
  /** Existing groups available to assign into — filtered to the selected member as you go.
   *  Pass [] (default) to hide the group picker entirely (e.g. read-only contexts). */
  groups?: MedicationGroupOption[];
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const memberChoices = members.filter((m) => writableMemberIds.includes(m.memberId));
  const defaultMemberId = resolveDefaultMemberId(
    currentMemberId,
    memberChoices.length > 0 ? memberChoices : members,
  );
  const [memberId, setMemberId] = useState(medication?.memberId ?? defaultMemberId);
  const [name, setName] = useState(medication?.name ?? "");
  const [dosage, setDosage] = useState(medication?.dosage ?? "");
  const [instructions, setInstructions] = useState(medication?.instructions ?? "");
  const [scheduleDraft, setScheduleDraft] = useState<MedScheduleDraft>(() =>
    medicationToScheduleDraft(medication),
  );
  /** Groups are many-to-many — a medication taken multiple times a day can have different doses
   *  in different groups, so this is a checklist, not a single choice. Also doubles as
   *  quick-create: filling in newGroupName creates one more group (inheriting this medication's
   *  own schedule/offsets) and joins it on save, so setting up "these meds go together" doesn't
   *  require a trip to the medication manager page. */
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    () => new Set(medication?.groupIds ?? []),
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [visibility, setVisibility] = useState<"household" | "private">(
    medication?.visibility ?? "private",
  );
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>(
    medication?.sharedMemberIds ?? [],
  );
  const [enabled, setEnabled] = useState(medication?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(medication?.memberId ?? defaultMemberId);
    setName(medication?.name ?? "");
    setDosage(medication?.dosage ?? "");
    setInstructions(medication?.instructions ?? "");
    setScheduleDraft(medicationToScheduleDraft(medication));
    setSelectedGroupIds(new Set(medication?.groupIds ?? []));
    setNewGroupName("");
    setVisibility(medication?.visibility ?? "private");
    setSharedMemberIds(medication?.sharedMemberIds ?? []);
    setEnabled(medication?.enabled ?? true);
  }, [open, medication, defaultMemberId]);

  // Groups are member-scoped — a selection from a previously-chosen member is invalid once
  // memberId changes, so drop any that no longer belong to the current member rather than let
  // save() send a mismatched pair.
  useEffect(() => {
    setSelectedGroupIds((prev) => {
      const validIds = new Set(groups.filter((g) => g.memberId === memberId).map((g) => g.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [memberId, groups]);

  async function save() {
    if (readOnly || !name.trim()) return;
    setBusy(true);
    setErr(null);
    const scheduleResult = scheduleDraftToRequestBody(scheduleDraft);
    if (!scheduleResult.ok) {
      setErr(scheduleResult.error);
      setBusy(false);
      return;
    }
    const body = {
      memberId,
      name: name.trim(),
      dosage: dosage.trim() || undefined,
      instructions: instructions.trim() || undefined,
      scheduleKind: scheduleResult.scheduleKind,
      schedule: scheduleResult.schedule,
      enabled,
      visibility,
      sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
    };
    try {
      let medicationId = medication?.id;
      if (medication) {
        await apiClient.patch(`/api/health/medications/${medication.id}`, body);
        medicationId = medication.id;
      } else {
        const created = await apiClient.post<{ medication: { id: string } }>(
          "/api/health/medications",
          body,
        );
        medicationId = created.medication.id;
      }

      // Quick-group: join/leave existing groups and optionally create-and-join one more, all in
      // this same save, so grouping meds that belong together doesn't require a trip to the
      // medication manager page. Switching to PRN drops every membership — a PRN med has no
      // shared due time to consolidate around (groups reject that schedule kind server-side too).
      if (medicationId) {
        const previousGroupIds = new Set(medication?.groupIds ?? []);
        const desiredGroupIds = scheduleResult.scheduleKind === "prn" ? new Set<string>() : selectedGroupIds;
        for (const groupId of desiredGroupIds) {
          if (previousGroupIds.has(groupId)) continue;
          await apiClient.post(`/api/health/medication-groups/${groupId}/members`, { medicationId });
        }
        for (const groupId of previousGroupIds) {
          if (desiredGroupIds.has(groupId)) continue;
          await apiClient.delete(`/api/health/medication-groups/${groupId}/members/${medicationId}`);
        }
        if (scheduleResult.scheduleKind !== "prn" && newGroupName.trim()) {
          await apiClient.post("/api/health/medication-groups", {
            memberId,
            name: newGroupName.trim(),
            scheduleKind: scheduleResult.scheduleKind,
            schedule: scheduleResult.schedule,
            medicationIds: [medicationId],
          });
        }
      }

      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={readOnly ? "Medication" : medication ? "Edit medication" : "Add medication"}
    >
      <fieldset className="space-y-4 px-6 py-4" disabled={readOnly}>
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {(memberChoices.length > 0 ? memberChoices : members).map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Dosage</span>
          <Input value={dosage} onChange={(e) => setDosage(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Instructions</span>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
          />
        </label>
        <MedScheduleEditor draft={scheduleDraft} onChange={setScheduleDraft} />
        {scheduleDraft.scheduleKind !== "prn" ? (
          <div className="space-y-2">
            <span className="text-sm font-medium text-[var(--color-text)]">
              Groups (reminders go out together — a med taken more than once a day can be in more
              than one, e.g. its 8am dose in one group and 8pm dose in another)
            </span>
            {groups.filter((g) => g.memberId === memberId).length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No existing groups for this person yet.</p>
            ) : (
              <ul className="space-y-1">
                {groups
                  .filter((g) => g.memberId === memberId)
                  .map((g) => (
                    <li key={g.id}>
                      <Checkbox
                        checked={selectedGroupIds.has(g.id)}
                        onChange={(e) => {
                          setSelectedGroupIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(g.id);
                            else next.delete(g.id);
                            return next;
                          });
                        }}
                        label={g.name}
                      />
                    </li>
                  ))}
              </ul>
            )}
            <label className="block space-y-1 text-sm">
              <span>+ New group (optional)</span>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Morning meds"
              />
            </label>
          </div>
        ) : null}
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label="Enabled" />
        <label className="block space-y-1 text-sm">
          <span>Visibility</span>
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "household" | "private")}
          >
            <option value="private">Private</option>
            <option value="household">Household</option>
          </Select>
        </label>
        {visibility === "private" ? (
          <NoteSharePicker
            members={members}
            currentMemberId={currentMemberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-med-share"
            hint="Private by default. Share with selected members so they can read this medication. You and the subject always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly ? null : (
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>
            Save
          </Button>
          )}
        </div>
      </fieldset>
    </Sheet>
  );
}
