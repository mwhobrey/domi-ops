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
  | "other";

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
}

export interface HealthMedication {
  id: string;
  memberId: string;
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

const EVENT_TYPES: { value: HealthEventType; label: string }[] = [
  { value: "sickness", label: "Sickness" },
  { value: "injury", label: "Injury" },
  { value: "appointment", label: "Appointment" },
  { value: "symptom", label: "Symptom" },
  { value: "medication", label: "Medication" },
  { value: "other", label: "Other" },
];

function memberLabel(members: NoteShareMember[], memberId: string): string {
  return members.find((m) => m.memberId === memberId)?.label ?? "Member";
}

function resolveDefaultMemberId(currentMemberId: string, members: NoteShareMember[]): string {
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

function MedTimesEditor({
  times,
  onChange,
}: {
  times: string[];
  onChange: (times: string[]) => void;
}) {
  // Stable row ids — keying by value remounts the input on every change and eats focus.
  const rowIdsRef = useRef<string[]>([]);
  if (rowIdsRef.current.length < times.length) {
    for (let i = rowIdsRef.current.length; i < times.length; i++) {
      rowIdsRef.current.push(`med-time-${i}-${Math.random().toString(36).slice(2, 9)}`);
    }
  } else if (rowIdsRef.current.length > times.length) {
    rowIdsRef.current = rowIdsRef.current.slice(0, times.length);
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-[var(--color-text)]">Times</span>
      <ul className="space-y-2">
        {times.map((time, index) => (
          <li key={rowIdsRef.current[index]} className="flex items-center gap-2">
            <Input
              type="time"
              className="flex-1"
              value={time.slice(0, 5)}
              onChange={(e) => {
                const next = [...times];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={times.length <= 1}
              onClick={() => {
                rowIdsRef.current = rowIdsRef.current.filter((_, i) => i !== index);
                onChange(times.filter((_, i) => i !== index));
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...times, "08:00"])}
      >
        + Add time
      </Button>
    </div>
  );
}

function HealthRow({
  title,
  subtitle,
  trailing,
  onClick,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <ListItem as={onClick ? "button" : "div"} onClick={onClick}>
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
  );
}

export function HealthPageClient({
  members,
  currentMemberId,
  householdTimezone,
  initialEventId,
  initialMedicationId,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
  householdTimezone: string;
  initialEventId?: string;
  initialMedicationId?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"today" | "events" | "medications">("today");
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [medications, setMedications] = useState<HealthMedication[]>([]);
  const [pendingDoses, setPendingDoses] = useState<PendingDose[]>([]);
  const [prnMeds, setPrnMeds] = useState<HealthMedication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [medSheetOpen, setMedSheetOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<HealthEvent | null>(null);
  const [editingMed, setEditingMed] = useState<HealthMedication | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, HealthAclGrants>>({});
  const [loggingAllKey, setLoggingAllKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, medsRes, glanceRes, capsRes] = await Promise.all([
        apiClient.get<{ events: HealthEvent[] }>("/api/health/events"),
        apiClient.get<{ medications: HealthMedication[] }>("/api/health/medications"),
        apiClient.get<{
          pendingDoses: PendingDose[];
          prnMedications: HealthMedication[];
        }>("/api/health/glance"),
        apiClient.get<{ bySubject: Record<string, HealthAclGrants> }>("/api/health/capabilities"),
      ]);
      setEvents(eventsRes.events);
      setMedications(medsRes.medications);
      setPendingDoses(glanceRes.pendingDoses);
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
    if (!initialMedicationId) return;
    const med = medications.find((m) => m.id === initialMedicationId);
    if (med) {
      setEditingMed(med);
      setMedSheetOpen(true);
      setTab("medications");
    }
  }, [initialMedicationId, medications]);

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

  const canAddEvent = members.some((m) => capabilities[m.memberId]?.events === "write");
  const canAddMed = members.some((m) => capabilities[m.memberId]?.medications === "write");

  function canLogForMember(memberId: string) {
    return capabilities[memberId]?.doses === "write";
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

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
              ) : pendingDoses.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No pending doses today.</p>
              ) : (
                groupPendingDosesByMemberThenTime(pendingDoses).map((memberGroup) => (
                  <div key={memberGroup.memberId} className="space-y-3">
                    <h3 className="text-sm font-semibold text-[var(--color-text)]">
                      {memberLabel(members, memberGroup.memberId)}
                    </h3>
                    {memberGroup.times.map((timeGroup) => {
                      const loggable = timeGroup.doses.filter((d) => canLogForMember(d.memberId));
                      const groupKey = `${memberGroup.memberId}:${timeGroup.scheduledTime}`;
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
                          {timeGroup.doses.map((dose) => (
                            <HealthRow
                              key={`${dose.medicationId}-${dose.scheduledAt}`}
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
                          ))}
                        </ul>
                      </div>
                      );
                    })}
                  </div>
                ))
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
          <div className="flex justify-end">
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
            events.map((ev) => (
              <HealthRow
                key={ev.id}
                title={ev.title}
                subtitle={`${EVENT_TYPES.find((t) => t.value === ev.type)?.label ?? ev.type} · ${memberLabel(members, ev.memberId)}${ev.durationKind === "ongoing" && !ev.endedAt ? " · Ongoing" : ""}`}
                trailing={
                  ev.visibility === "private" ? <Badge tone="default">Private</Badge> : null
                }
                onClick={() => {
                  setEditingEvent(ev);
                  setEventSheetOpen(true);
                }}
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "medications" ? (
        <div className="space-y-4">
          {canAddMed ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setEditingMed(null);
                setMedSheetOpen(true);
              }}
            >
              Add medication
            </Button>
          </div>
          ) : null}
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

      <HealthMedicationSheet
        open={medSheetOpen}
        medication={editingMed}
        members={members}
        currentMemberId={currentMemberId}
        writableMemberIds={members
          .filter((m) => capabilities[m.memberId]?.medications === "write")
          .map((m) => m.memberId)}
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
    setSharedMemberIds(event?.sharedMemberIds ?? []);
  }, [open, event, defaultMemberId, householdTimezone]);

  async function save() {
    if (readOnly || !title.trim()) return;
    setBusy(true);
    setErr(null);
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

function HealthMedicationSheet({
  open,
  medication,
  members,
  currentMemberId,
  writableMemberIds,
  readOnly = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  medication: HealthMedication | null;
  members: NoteShareMember[];
  currentMemberId: string;
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
  const [memberId, setMemberId] = useState(medication?.memberId ?? defaultMemberId);
  const [name, setName] = useState(medication?.name ?? "");
  const [dosage, setDosage] = useState(medication?.dosage ?? "");
  const [instructions, setInstructions] = useState(medication?.instructions ?? "");
  const [scheduleKind, setScheduleKind] = useState<"scheduled" | "prn" | "interval">(
    medication?.scheduleKind ?? "scheduled",
  );
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(
    medication?.schedule?.times?.length ? medication.schedule.times : ["08:00"],
  );
  const [everyAmount, setEveryAmount] = useState(() => {
    const m = medication?.schedule?.everyMinutes;
    if (!m) return "";
    if (m % (24 * 60) === 0) return String(m / (24 * 60));
    if (m % 60 === 0) return String(m / 60);
    return String(m);
  });
  const [everyUnit, setEveryUnit] = useState<"minutes" | "hours" | "days">(() => {
    const m = medication?.schedule?.everyMinutes;
    if (!m) return "hours";
    if (m % (24 * 60) === 0) return "days";
    if (m % 60 === 0) return "hours";
    return "minutes";
  });
  const [intervalAnchor, setIntervalAnchor] = useState<"first_taken" | "fixed_start">(
    medication?.schedule?.anchor === "fixed_start" ? "fixed_start" : "first_taken",
  );
  const [fixedStartTime, setFixedStartTime] = useState(
    medication?.schedule?.fixedStartTime ?? "08:00",
  );
  const [intervalFrom, setIntervalFrom] = useState<"last_taken" | "schedule_grid">(
    medication?.schedule?.intervalFrom === "schedule_grid" ? "schedule_grid" : "last_taken",
  );
  const [stopMode, setStopMode] = useState<"max_doses" | "end_time" | "midnight">(
    medication?.schedule?.stop?.mode === "end_time" || medication?.schedule?.stop?.mode === "midnight"
      ? medication.schedule.stop.mode
      : "max_doses",
  );
  const [maxDoses, setMaxDoses] = useState(
    medication?.schedule?.stop?.maxDoses != null ? String(medication.schedule.stop.maxDoses) : "",
  );
  const [endTime, setEndTime] = useState(medication?.schedule?.stop?.endTime ?? "22:00");
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
    setScheduleKind(medication?.scheduleKind ?? "scheduled");
    setScheduleTimes(
      medication?.schedule?.times?.length ? medication.schedule.times : ["08:00"],
    );
    const m = medication?.schedule?.everyMinutes;
    if (!m) {
      setEveryAmount("");
      setEveryUnit("hours");
    } else if (m % (24 * 60) === 0) {
      setEveryAmount(String(m / (24 * 60)));
      setEveryUnit("days");
    } else if (m % 60 === 0) {
      setEveryAmount(String(m / 60));
      setEveryUnit("hours");
    } else {
      setEveryAmount(String(m));
      setEveryUnit("minutes");
    }
    setIntervalAnchor(
      medication?.schedule?.anchor === "fixed_start" ? "fixed_start" : "first_taken",
    );
    setFixedStartTime(medication?.schedule?.fixedStartTime ?? "08:00");
    setIntervalFrom(
      medication?.schedule?.intervalFrom === "schedule_grid" ? "schedule_grid" : "last_taken",
    );
    setStopMode(
      medication?.schedule?.stop?.mode === "end_time" || medication?.schedule?.stop?.mode === "midnight"
        ? medication.schedule.stop.mode
        : "max_doses",
    );
    setMaxDoses(
      medication?.schedule?.stop?.maxDoses != null ? String(medication.schedule.stop.maxDoses) : "",
    );
    setEndTime(medication?.schedule?.stop?.endTime ?? "22:00");
    setVisibility(medication?.visibility ?? "private");
    setSharedMemberIds(medication?.sharedMemberIds ?? []);
    setEnabled(medication?.enabled ?? true);
  }, [open, medication, defaultMemberId]);

  async function save() {
    if (readOnly || !name.trim()) return;
    setBusy(true);
    setErr(null);
    const scheduleTimesNormalized = scheduleTimes
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.length >= 5 ? t.slice(0, 5) : t));
    let everyMinutes: number | undefined;
    if (scheduleKind === "interval") {
      const amount = Number(everyAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setErr("Enter how often doses repeat");
        setBusy(false);
        return;
      }
      everyMinutes =
        everyUnit === "days" ? amount * 24 * 60 : everyUnit === "hours" ? amount * 60 : amount;
      if (stopMode === "max_doses" && (!maxDoses.trim() || Number(maxDoses) < 1)) {
        setErr("Enter max doses per day");
        setBusy(false);
        return;
      }
    }
    const body = {
      memberId,
      name: name.trim(),
      dosage: dosage.trim() || undefined,
      instructions: instructions.trim() || undefined,
      scheduleKind,
      schedule:
        scheduleKind === "scheduled"
          ? { times: scheduleTimesNormalized }
          : scheduleKind === "interval"
            ? {
                everyMinutes,
                anchor: intervalAnchor,
                fixedStartTime: intervalAnchor === "fixed_start" ? fixedStartTime : undefined,
                intervalFrom,
                stop: {
                  mode: stopMode,
                  maxDoses: stopMode === "max_doses" ? Number(maxDoses) : undefined,
                  endTime: stopMode === "end_time" ? endTime : undefined,
                },
              }
            : undefined,
      enabled,
      visibility,
      sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
    };
    try {
      if (medication) {
        await apiClient.patch(`/api/health/medications/${medication.id}`, body);
      } else {
        await apiClient.post("/api/health/medications", body);
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
        <label className="block space-y-1 text-sm">
          <span>Schedule</span>
          <Select
            value={scheduleKind}
            onChange={(e) => setScheduleKind(e.target.value as "scheduled" | "prn" | "interval")}
          >
            <option value="scheduled">Scheduled times</option>
            <option value="interval">Every N (interval)</option>
            <option value="prn">PRN (as needed)</option>
          </Select>
        </label>
        {scheduleKind === "scheduled" ? (
          <MedTimesEditor times={scheduleTimes} onChange={setScheduleTimes} />
        ) : null}
        {scheduleKind === "interval" ? (
          <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
            <div className="flex flex-wrap gap-2">
              <label className="block flex-1 space-y-1 text-sm">
                <span>Every</span>
                <Input
                  type="number"
                  min={1}
                  value={everyAmount}
                  onChange={(e) => setEveryAmount(e.target.value)}
                  placeholder="e.g. 3"
                />
              </label>
              <label className="block w-32 space-y-1 text-sm">
                <span>Unit</span>
                <Select
                  value={everyUnit}
                  onChange={(e) => setEveryUnit(e.target.value as "minutes" | "hours" | "days")}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </Select>
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span>Start</span>
              <Select
                value={intervalAnchor}
                onChange={(e) =>
                  setIntervalAnchor(e.target.value as "first_taken" | "fixed_start")
                }
              >
                <option value="first_taken">When first dose is Taken</option>
                <option value="fixed_start">At a set morning time</option>
              </Select>
            </label>
            {intervalAnchor === "fixed_start" ? (
              <label className="block space-y-1 text-sm">
                <span>Start time</span>
                <Input
                  type="time"
                  value={fixedStartTime}
                  onChange={(e) => setFixedStartTime(e.target.value)}
                />
              </label>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span>After that, next due is</span>
              <Select
                value={intervalFrom}
                onChange={(e) =>
                  setIntervalFrom(e.target.value as "last_taken" | "schedule_grid")
                }
              >
                <option value="last_taken">Last Taken + interval</option>
                <option value="schedule_grid">Fixed grid from start (even if late)</option>
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Stop for the day</span>
              <Select
                value={stopMode}
                onChange={(e) =>
                  setStopMode(e.target.value as "max_doses" | "end_time" | "midnight")
                }
              >
                <option value="max_doses">Max doses</option>
                <option value="end_time">After an end time</option>
                <option value="midnight">Local midnight</option>
              </Select>
            </label>
            {stopMode === "max_doses" ? (
              <label className="block space-y-1 text-sm">
                <span>Max doses / day</span>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={maxDoses}
                  onChange={(e) => setMaxDoses(e.target.value)}
                  placeholder="e.g. 5"
                />
              </label>
            ) : null}
            {stopMode === "end_time" ? (
              <label className="block space-y-1 text-sm">
                <span>End time</span>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            ) : null}
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
