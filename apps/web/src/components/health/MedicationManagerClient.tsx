"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { NoteSharePicker } from "../NoteSharePicker";
import type { HealthAclGrants } from "../HealthPeopleAccessPanel";
import {
  HealthMedicationSheet,
  memberLabel,
  resolveDefaultMemberId,
  type HealthMedication,
} from "../HealthPageClient";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  EmptyState,
  Input,
  ListItem,
  SectionHeader,
  Select,
  Sheet,
} from "../ui";
import {
  MedScheduleEditor,
  medicationToScheduleDraft,
  scheduleDraftToRequestBody,
  type MedScheduleDraft,
} from "./MedScheduleEditor";

export interface MedicationGroup {
  id: string;
  memberId: string;
  name: string;
  scheduleKind: "scheduled" | "interval";
  schedule: Record<string, unknown>;
  reminderOffsets: number[];
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
  visibility: "household" | "private";
  sharedMemberIds?: string[];
  isOwnedByMe?: boolean;
  canEdit?: boolean;
  medications: HealthMedication[];
}

function scheduleSummary(kind: "scheduled" | "interval", schedule: Record<string, unknown>): string {
  if (kind === "scheduled") {
    const times = Array.isArray(schedule.times) ? (schedule.times as string[]) : [];
    return times.length > 0 ? times.map((t) => t.slice(0, 5)).join(", ") : "No times set";
  }
  const every = typeof schedule.everyMinutes === "number" ? schedule.everyMinutes : null;
  if (!every) return "Every…";
  if (every % (24 * 60) === 0) return `Every ${every / (24 * 60)} day(s)`;
  if (every % 60 === 0) return `Every ${every / 60} hour(s)`;
  return `Every ${every} minute(s)`;
}

type TimelineChip = {
  key: string;
  hhmm: string;
  minutesOfDay: number;
  label: string;
  detail: string;
  kind: "group" | "medication";
};

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function DayTimeline({ chips }: { chips: TimelineChip[] }) {
  if (chips.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No fixed-time schedules yet.</p>;
  }
  return (
    <div className="space-y-1">
      <div className="relative h-14 rounded-lg bg-[var(--color-surface-secondary)]">
        {chips.map((chip) => (
          <div
            key={chip.key}
            title={`${chip.detail} · ${chip.hhmm}`}
            className={
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-surface)] " +
              (chip.kind === "group"
                ? "h-4 w-4 bg-[var(--color-accent)]"
                : "h-3 w-3 bg-[var(--color-text-muted)]")
            }
            style={{ left: `${(chip.minutesOfDay / 1440) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-accent)]" /> Group
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-text-muted)]" /> Individual
          medication
        </span>
      </div>
    </div>
  );
}

function MedGroupSheet({
  open,
  group,
  memberId,
  memberLabelText,
  members,
  candidateMedications,
  onClose,
  onSaved,
}: {
  open: boolean;
  group: MedicationGroup | null;
  memberId: string;
  memberLabelText: string;
  members: NoteShareMember[];
  /** Every medication for this member — scheduled/interval kind, whether currently grouped or not
   *  (a member medication currently in *this* group shows pre-checked; one in a *different*
   *  group is omitted, since moving it should happen from that other group's own sheet). */
  candidateMedications: HealthMedication[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [scheduleDraft, setScheduleDraft] = useState<MedScheduleDraft>(() =>
    medicationToScheduleDraft(group ? { scheduleKind: group.scheduleKind, schedule: group.schedule } : null),
  );
  const [offsetsText, setOffsetsText] = useState(() => (group?.reminderOffsets ?? [0]).join(", "));
  const [enabled, setEnabled] = useState(group?.enabled ?? true);
  const [visibility, setVisibility] = useState<"household" | "private">(group?.visibility ?? "private");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>(group?.sharedMemberIds ?? []);
  const [selectedMedIds, setSelectedMedIds] = useState<Set<string>>(
    () => new Set((group?.medications ?? []).map((m) => m.id)),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setScheduleDraft(
      medicationToScheduleDraft(group ? { scheduleKind: group.scheduleKind, schedule: group.schedule } : null),
    );
    setOffsetsText((group?.reminderOffsets ?? [0]).join(", "));
    setEnabled(group?.enabled ?? true);
    setVisibility(group?.visibility ?? "private");
    setSharedMemberIds(group?.sharedMemberIds ?? []);
    setSelectedMedIds(new Set((group?.medications ?? []).map((m) => m.id)));
    setErr(null);
  }, [open, group]);

  const eligibleMeds = candidateMedications.filter(
    (m) => !m.groupId || (group && m.groupId === group.id),
  );

  // As the group's own times are set, surface ungrouped meds that already share one — the
  // actual point of grouping is consolidating pre-existing same-time reminders, so offer to
  // bulk-add them instead of making the user hunt through the checklist to remember which ones.
  const draftTimes = new Set(scheduleDraft.times.map((t) => t.slice(0, 5)));
  const matchingTimeMeds =
    scheduleDraft.scheduleKind === "scheduled" && draftTimes.size > 0
      ? eligibleMeds.filter(
          (m) =>
            m.scheduleKind === "scheduled" &&
            !selectedMedIds.has(m.id) &&
            (m.schedule.times ?? []).some((t) => draftTimes.has(t.slice(0, 5))),
        )
      : [];

  async function save() {
    if (!name.trim()) {
      setErr("Enter a name");
      return;
    }
    const scheduleResult = scheduleDraftToRequestBody(scheduleDraft);
    if (!scheduleResult.ok) {
      setErr(scheduleResult.error);
      return;
    }
    if (scheduleResult.scheduleKind === "prn") {
      setErr("Groups can't be PRN — pick Scheduled or Every N.");
      return;
    }
    const reminderOffsets = offsetsText
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);

    setBusy(true);
    setErr(null);
    try {
      const body = {
        memberId,
        name: name.trim(),
        scheduleKind: scheduleResult.scheduleKind,
        schedule: scheduleResult.schedule,
        reminderOffsets: reminderOffsets.length > 0 ? reminderOffsets : [0],
        enabled,
        visibility,
        sharedMemberIds: visibility === "private" ? sharedMemberIds : undefined,
      };
      let groupId = group?.id;
      if (group) {
        await apiClient.patch(`/api/health/medication-groups/${group.id}`, body);
      } else {
        const created = await apiClient.post<{ group: { id: string } }>(
          "/api/health/medication-groups",
          body,
        );
        groupId = created.group.id;
      }
      if (!groupId) throw new Error("Group save failed");

      const previouslyIn = new Set((group?.medications ?? []).map((m) => m.id));
      const toAdd = [...selectedMedIds].filter((id) => !previouslyIn.has(id));
      const toRemove = [...previouslyIn].filter((id) => !selectedMedIds.has(id));
      for (const medicationId of toAdd) {
        await apiClient.post(`/api/health/medication-groups/${groupId}/members`, { medicationId });
      }
      for (const medicationId of toRemove) {
        await apiClient.delete(`/api/health/medication-groups/${groupId}/members/${medicationId}`);
      }

      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={group ? "Edit group" : "New medication group"}>
      <div className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <p className="text-sm text-[var(--color-text-muted)]">For {memberLabelText}</p>
        <label className="block space-y-1 text-sm">
          <span>Group name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning meds" />
        </label>
        <MedScheduleEditor draft={scheduleDraft} onChange={setScheduleDraft} allowPrn={false} />
        <label className="block space-y-1 text-sm">
          <span>Remind (minutes before each dose, comma-separated — 0 = at dose time)</span>
          <Input value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} placeholder="0, 15" />
        </label>
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
            currentMemberId={memberId}
            value={sharedMemberIds}
            onChange={setSharedMemberIds}
            namePrefix="health-medgroup-share"
            hint="Private by default. Share with selected members so they can read this group."
          />
        ) : null}
        {matchingTimeMeds.length > 0 ? (
          <Alert variant="info">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {matchingTimeMeds.length} medication{matchingTimeMeds.length > 1 ? "s" : ""} for{" "}
                {memberLabelText} already scheduled at this time: {matchingTimeMeds.map((m) => m.name).join(", ")}.
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setSelectedMedIds((prev) => {
                    const next = new Set(prev);
                    for (const m of matchingTimeMeds) next.add(m.id);
                    return next;
                  });
                }}
              >
                Add all
              </Button>
            </div>
          </Alert>
        ) : null}
        <div className="space-y-2">
          <span className="text-sm font-medium text-[var(--color-text)]">Medications in this group</span>
          {eligibleMeds.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No scheduled/interval medications available for {memberLabelText} yet — add one from the
              Individual medications list first.
            </p>
          ) : (
            <ul className="space-y-1">
              {eligibleMeds.map((med) => {
                const sharesTime =
                  scheduleDraft.scheduleKind === "scheduled" &&
                  med.scheduleKind === "scheduled" &&
                  (med.schedule.times ?? []).some((t) => draftTimes.has(t.slice(0, 5)));
                return (
                <li key={med.id}>
                  <Checkbox
                    checked={selectedMedIds.has(med.id)}
                    onChange={(e) => {
                      setSelectedMedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(med.id);
                        else next.delete(med.id);
                        return next;
                      });
                    }}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        {med.name}
                        {med.dosage ? ` · ${med.dosage}` : ""}
                        {sharesTime ? <Badge tone="accent">Same time</Badge> : null}
                      </span>
                    }
                  />
                </li>
                );
              })}
            </ul>
          )}
        </div>
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

export function MedicationManagerClient({
  members,
  currentMemberId,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState(() =>
    resolveDefaultMemberId(currentMemberId, members),
  );
  const [medications, setMedications] = useState<HealthMedication[]>([]);
  const [groups, setGroups] = useState<MedicationGroup[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, HealthAclGrants>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [medSheetOpen, setMedSheetOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<HealthMedication | null>(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<MedicationGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [medsRes, groupsRes, capsRes] = await Promise.all([
        apiClient.get<{ medications: HealthMedication[] }>("/api/health/medications"),
        apiClient.get<{ groups: MedicationGroup[] }>("/api/health/medication-groups"),
        apiClient.get<{ bySubject: Record<string, HealthAclGrants> }>("/api/health/capabilities"),
      ]);
      setMedications(medsRes.medications);
      setGroups(groupsRes.groups);
      setCapabilities(capsRes.bySubject ?? {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load medications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const writableMemberIds = members
    .filter((m) => capabilities[m.memberId]?.medications === "write")
    .map((m) => m.memberId);
  const canWriteSelected = writableMemberIds.includes(selectedMemberId);

  const memberMeds = medications.filter((m) => m.memberId === selectedMemberId);
  const ungroupedMeds = memberMeds.filter((m) => !m.groupId);
  const memberGroups = groups.filter((g) => g.memberId === selectedMemberId);

  const timelineChips = useMemo<TimelineChip[]>(() => {
    const chips: TimelineChip[] = [];
    for (const g of memberGroups) {
      if (g.scheduleKind !== "scheduled") continue;
      const times = Array.isArray(g.schedule.times) ? (g.schedule.times as string[]) : [];
      for (const t of times) {
        chips.push({
          key: `group-${g.id}-${t}`,
          hhmm: t,
          minutesOfDay: timeToMinutes(t),
          label: g.name,
          detail: `${g.name} (${g.medications.length} meds)`,
          kind: "group",
        });
      }
    }
    for (const med of ungroupedMeds) {
      if (med.scheduleKind !== "scheduled") continue;
      const times = med.schedule.times ?? [];
      for (const t of times) {
        chips.push({
          key: `med-${med.id}-${t}`,
          hhmm: t,
          minutesOfDay: timeToMinutes(t),
          label: med.name,
          detail: med.name,
          kind: "medication",
        });
      }
    }
    return chips.sort((a, b) => a.minutesOfDay - b.minutesOfDay);
  }, [memberGroups, ungroupedMeds]);

  const intervalOrPrnMeds = ungroupedMeds.filter((m) => m.scheduleKind !== "scheduled");
  const intervalGroups = memberGroups.filter((g) => g.scheduleKind === "interval");

  async function deleteGroup(group: MedicationGroup) {
    if (!confirm(`Delete "${group.name}"? Member medications go back to their own schedule.`)) return;
    try {
      await apiClient.delete(`/api/health/medication-groups/${group.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete group");
    }
  }

  async function deleteMedication(med: HealthMedication) {
    if (!confirm(`Delete "${med.name}"?`)) return;
    try {
      await apiClient.delete(`/api/health/medications/${med.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete medication");
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <Button
            key={m.memberId}
            size="sm"
            variant={selectedMemberId === m.memberId ? "primary" : "secondary"}
            onClick={() => setSelectedMemberId(m.memberId)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader title={`${memberLabel(members, selectedMemberId)}'s day`} />
              <DayTimeline chips={timelineChips} />
              {intervalOrPrnMeds.length > 0 || intervalGroups.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  {intervalGroups.map((g) => (
                    <Badge key={g.id} tone="accent">
                      {g.name} · {scheduleSummary("interval", g.schedule)}
                    </Badge>
                  ))}
                  {intervalOrPrnMeds.map((m) => (
                    <Badge key={m.id}>
                      {m.name} · {m.scheduleKind === "prn" ? "PRN" : "interval"}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionHeader title="Groups" />
                {canWriteSelected ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingGroup(null);
                      setGroupSheetOpen(true);
                    }}
                  >
                    + New group
                  </Button>
                ) : null}
              </div>
              {memberGroups.length === 0 ? (
                <EmptyState
                  title="No groups yet"
                  description="Bundle medications that share a time so reminders arrive together instead of one at a time."
                />
              ) : (
                <ul className="space-y-3">
                  {memberGroups.map((group) => (
                    <li
                      key={group.id}
                      className="space-y-2 rounded-lg border border-[var(--color-border)] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-[var(--color-text)]">
                            {group.name}
                            {!group.enabled ? (
                              <span className="ml-2">
                                <Badge>Disabled</Badge>
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-[var(--color-text-muted)]">
                            {scheduleSummary(group.scheduleKind, group.schedule)}
                          </p>
                        </div>
                        {canWriteSelected ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditingGroup(group);
                                setGroupSheetOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => void deleteGroup(group)}>
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {group.medications.length === 0 ? (
                          <span className="text-sm text-[var(--color-text-muted)]">No medications yet</span>
                        ) : (
                          group.medications.map((m) => <Badge key={m.id}>{m.name}</Badge>)
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionHeader title="Individual medications" />
                {canWriteSelected ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingMed(null);
                      setMedSheetOpen(true);
                    }}
                  >
                    + Add medication
                  </Button>
                ) : null}
              </div>
              {ungroupedMeds.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No standalone medications — everything for {memberLabel(members, selectedMemberId)} is
                  either grouped above or none exist yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {ungroupedMeds.map((med) => (
                    <ListItem key={med.id}>
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--color-text)]">{med.name}</p>
                          <p className="truncate text-sm text-[var(--color-text-muted)]">
                            {med.dosage ? `${med.dosage} · ` : ""}
                            {med.scheduleKind === "scheduled"
                              ? scheduleSummary("scheduled", med.schedule)
                              : med.scheduleKind === "interval"
                                ? scheduleSummary("interval", med.schedule)
                                : "As needed"}
                          </p>
                        </div>
                        {canWriteSelected ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditingMed(med);
                                setMedSheetOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => void deleteMedication(med)}>
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </ListItem>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <HealthMedicationSheet
        open={medSheetOpen}
        medication={editingMed}
        members={members}
        currentMemberId={selectedMemberId}
        writableMemberIds={writableMemberIds}
        groups={groups}
        onClose={() => {
          setMedSheetOpen(false);
          setEditingMed(null);
        }}
        onSaved={() => {
          setMedSheetOpen(false);
          setEditingMed(null);
          void load();
        }}
      />

      <MedGroupSheet
        open={groupSheetOpen}
        group={editingGroup}
        memberId={selectedMemberId}
        memberLabelText={memberLabel(members, selectedMemberId)}
        members={members}
        candidateMedications={memberMeds.filter((m) => m.scheduleKind !== "prn")}
        onClose={() => {
          setGroupSheetOpen(false);
          setEditingGroup(null);
        }}
        onSaved={() => {
          setGroupSheetOpen(false);
          setEditingGroup(null);
          void load();
        }}
      />
    </div>
  );
}
