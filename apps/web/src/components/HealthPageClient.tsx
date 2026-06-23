"use client";

import { Heart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiClient } from "../lib/client-api";
import type { NoteShareMember } from "./NoteSharePicker";
import { NoteSharePicker } from "./NoteSharePicker";
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
}

export interface HealthMedication {
  id: string;
  memberId: string;
  name: string;
  dosage: string | null;
  instructions: string | null;
  scheduleKind: "scheduled" | "prn";
  schedule: { times?: string[]; daysOfWeek?: number[] };
  reminderOffsets: number[];
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
  visibility: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
}

interface PendingDose {
  medicationId: string;
  name: string;
  scheduledAt: string;
  scheduledTime: string;
  scheduledTimeLabel: string;
  memberId: string;
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
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-[var(--color-text)]">Times</span>
      <ul className="space-y-2">
        {times.map((time, index) => (
          <li key={`${index}-${time}`} className="flex items-center gap-2">
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
              onClick={() => onChange(times.filter((_, i) => i !== index))}
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, medsRes, glanceRes] = await Promise.all([
        apiClient.get<{ events: HealthEvent[] }>("/api/health/events"),
        apiClient.get<{ medications: HealthMedication[] }>("/api/health/medications"),
        apiClient.get<{
          pendingDoses: PendingDose[];
          prnMedications: HealthMedication[];
        }>("/api/health/glance"),
      ]);
      setEvents(eventsRes.events);
      setMedications(medsRes.medications);
      setPendingDoses(glanceRes.pendingDoses);
      setPrnMeds(glanceRes.prnMedications);
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
  ) {
    try {
      await apiClient.post(`/api/health/medications/${medicationId}/log`, opts);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log dose");
    }
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
        <ModuleReportsLink module="health" />
      </div>

      {tab === "today" ? (
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader title="Scheduled doses" />
              {loading ? (
                <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
              ) : pendingDoses.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No pending doses today.</p>
              ) : (
                pendingDoses.map((dose) => (
                  <HealthRow
                    key={`${dose.medicationId}-${dose.scheduledAt}`}
                    title={dose.name}
                    subtitle={dose.scheduledTimeLabel || dose.scheduledTime}
                    trailing={
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
                          Taken
                        </Button>
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
                      </div>
                    }
                  />
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-3">
              <SectionHeader title="PRN medications" />
              {prnMeds.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No as-needed meds.</p>
              ) : (
                prnMeds.map((med) => (
                  <HealthRow
                    key={med.id}
                    title={med.name}
                    subtitle={med.dosage ?? "As needed"}
                    trailing={
                      <Button size="sm" onClick={() => void logDose(med.id, {})}>
                        Log dose
                      </Button>
                    }
                  />
                ))
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="space-y-4">
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
                subtitle={`${med.scheduleKind === "prn" ? "PRN" : "Scheduled"} · ${memberLabel(members, med.memberId)}`}
                trailing={
                  <Badge tone={med.enabled ? "accent" : "default"}>
                    {med.scheduleKind === "prn" ? "PRN" : "Scheduled"}
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
  onClose,
  onSaved,
}: {
  open: boolean;
  event: HealthEvent | null;
  members: NoteShareMember[];
  currentMemberId: string;
  householdTimezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultMemberId = resolveDefaultMemberId(currentMemberId, members);
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
    event?.visibility ?? "household",
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
    setVisibility(event?.visibility ?? "household");
    setSharedMemberIds(event?.sharedMemberIds ?? []);
  }, [open, event, defaultMemberId, householdTimezone]);

  async function save() {
    if (!title.trim()) return;
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
    <Sheet open={open} onClose={onClose} title={event ? "Edit event" : "Add health event"}>
      <div className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
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
            <option value="household">Household</option>
            <option value="private">Private</option>
          </Select>
        </label>
        {visibility === "private" ? (
          <NoteSharePicker
            members={members}
            currentMemberId={currentMemberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-event-share"
            hint="Optional. Selected members can read this private health event. You always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !title.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function HealthMedicationSheet({
  open,
  medication,
  members,
  currentMemberId,
  onClose,
  onSaved,
}: {
  open: boolean;
  medication: HealthMedication | null;
  members: NoteShareMember[];
  currentMemberId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultMemberId = resolveDefaultMemberId(currentMemberId, members);
  const [memberId, setMemberId] = useState(medication?.memberId ?? defaultMemberId);
  const [name, setName] = useState(medication?.name ?? "");
  const [dosage, setDosage] = useState(medication?.dosage ?? "");
  const [instructions, setInstructions] = useState(medication?.instructions ?? "");
  const [scheduleKind, setScheduleKind] = useState<"scheduled" | "prn">(
    medication?.scheduleKind ?? "scheduled",
  );
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(
    medication?.schedule?.times?.length ? medication.schedule.times : ["08:00"],
  );
  const [visibility, setVisibility] = useState<"household" | "private">(
    medication?.visibility ?? "household",
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
    setVisibility(medication?.visibility ?? "household");
    setSharedMemberIds(medication?.sharedMemberIds ?? []);
    setEnabled(medication?.enabled ?? true);
  }, [open, medication, defaultMemberId]);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    const scheduleTimesNormalized = scheduleTimes
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.length >= 5 ? t.slice(0, 5) : t));
    const body = {
      memberId,
      name: name.trim(),
      dosage: dosage.trim() || undefined,
      instructions: instructions.trim() || undefined,
      scheduleKind,
      schedule:
        scheduleKind === "scheduled" ? { times: scheduleTimesNormalized } : undefined,
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
    <Sheet open={open} onClose={onClose} title={medication ? "Edit medication" : "Add medication"}>
      <div className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <label className="block space-y-1 text-sm">
          <span>Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
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
            onChange={(e) => setScheduleKind(e.target.value as "scheduled" | "prn")}
          >
            <option value="scheduled">Scheduled times</option>
            <option value="prn">PRN (as needed)</option>
          </Select>
        </label>
        {scheduleKind === "scheduled" ? (
          <MedTimesEditor times={scheduleTimes} onChange={setScheduleTimes} />
        ) : null}
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label="Enabled" />
        <label className="block space-y-1 text-sm">
          <span>Visibility</span>
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "household" | "private")}
          >
            <option value="household">Household</option>
            <option value="private">Private</option>
          </Select>
        </label>
        {visibility === "private" ? (
          <NoteSharePicker
            members={members}
            currentMemberId={currentMemberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-med-share"
            hint="Optional. Selected members can read this private medication. You always have access."
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
