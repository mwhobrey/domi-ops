"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { NoteShareMember } from "../NoteSharePicker";
import { NoteSharePicker } from "../NoteSharePicker";
import { Alert, Button, Checkbox, Input, Select, Sheet, Textarea } from "../ui";
import {
  MedScheduleEditor,
  medicationToScheduleDraft,
  scheduleDraftToRequestBody,
  type MedScheduleDraft,
} from "./MedScheduleEditor";
import { resolveDefaultMemberId } from "./health-helpers";
import type { HealthMedication, MedicationGroupOption } from "./health-types";

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

