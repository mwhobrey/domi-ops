"use client";

import { useEffect, useRef, useState } from "react";
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
import { isAsNeededMedScheduleKind, resolveDefaultMemberId } from "./health-helpers";
import type { HealthMedication, MedicationGroupOption } from "./health-types";
import { pharmacyErrorMessage } from "./pharmacy-helpers";
import type { Pharmacy } from "./supply-types";

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
  /** The pharmacy that fills this medication ("" = none). Optional, one at a time (WHO-421). */
  const [pharmacyId, setPharmacyId] = useState(medication?.pharmacy?.id ?? "");
  const [newPharmacyName, setNewPharmacyName] = useState("");
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [canAddPharmacy, setCanAddPharmacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Set once a new medication exists, so a retry after a later step failed edits it instead of adding a second. */
  const createdIdRef = useRef<string | null>(null);
  /** One idempotency key for the supply change of this save, and the pharmacy it already assigned, so a
   *  retry after a later step failed neither resends it with a stale version nor under a new key. */
  const supplyKeyRef = useRef<string | null>(null);
  const assignedPharmacyRef = useRef<string | null>(null);
  const supplyVersionRef = useRef<number | null>(null);

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
    setPharmacyId(medication?.pharmacy?.id ?? "");
    setNewPharmacyName("");
    createdIdRef.current = null;
    supplyKeyRef.current = null;
    assignedPharmacyRef.current = null;
    supplyVersionRef.current = null;
  }, [open, medication, defaultMemberId]);

  // The directory for the picker: active pharmacies only. If listing fails the picker simply stays empty.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .get<{ pharmacies: Pharmacy[]; canEdit: boolean }>("/api/health/pharmacies")
      .then((res) => {
        if (cancelled) return;
        setPharmacies(res.pharmacies);
        setCanAddPharmacy(res.canEdit);
      })
      .catch(() => {
        if (!cancelled) setPharmacies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
      let medicationId = medication?.id ?? createdIdRef.current ?? undefined;
      if (medicationId) {
        await apiClient.patch(`/api/health/medications/${medicationId}`, body);
      } else {
        const created = await apiClient.post<{ medication: { id: string } }>(
          "/api/health/medications",
          body,
        );
        medicationId = created.medication.id;
        createdIdRef.current = medicationId;
      }

      // Pharmacy: create the typed one if there is one, then assign when it differs from what the
      // medication already had. The version makes a stale edit fail instead of overwriting someone else's.
      if (medicationId) {
        let desiredPharmacyId = pharmacyId;
        if (newPharmacyName.trim()) {
          const created = await apiClient.post<{ pharmacy: Pharmacy }>("/api/health/pharmacies", {
            name: newPharmacyName.trim(),
          });
          desiredPharmacyId = created.pharmacy.id;
          setPharmacyId(desiredPharmacyId);
          setNewPharmacyName("");
        }
        const currentPharmacyId = assignedPharmacyRef.current ?? (medication?.pharmacy?.id ?? "");
        if (desiredPharmacyId !== currentPharmacyId) {
          supplyKeyRef.current ??= crypto.randomUUID();
          const knownVersion = supplyVersionRef.current ?? medication?.supply?.version;
          const saved = await apiClient.put<{ supply: { version: number } | null }>(
            `/api/health/medications/${medicationId}/supply`,
            {
              pharmacyId: desiredPharmacyId || null,
              ...(knownVersion !== undefined ? { version: knownVersion } : {}),
              idempotencyKey: supplyKeyRef.current,
            },
          );
          supplyVersionRef.current = saved.supply?.version ?? null;
          assignedPharmacyRef.current = desiredPharmacyId;
          supplyKeyRef.current = null;
        }
      }

      // Quick-group: join/leave existing groups and optionally create-and-join one more, all in
      // this same save, so grouping meds that belong together doesn't require a trip to the
      // medication manager page. Switching to PRN drops every membership — a PRN med has no
      // shared due time to consolidate around (groups reject that schedule kind server-side too).
      if (medicationId) {
        const previousGroupIds = new Set(medication?.groupIds ?? []);
        const desiredGroupIds = isAsNeededMedScheduleKind(scheduleResult.scheduleKind)
          ? new Set<string>()
          : selectedGroupIds;
        for (const groupId of desiredGroupIds) {
          if (previousGroupIds.has(groupId)) continue;
          await apiClient.post(`/api/health/medication-groups/${groupId}/members`, { medicationId });
        }
        for (const groupId of previousGroupIds) {
          if (desiredGroupIds.has(groupId)) continue;
          await apiClient.delete(`/api/health/medication-groups/${groupId}/members/${medicationId}`);
        }
        if (!isAsNeededMedScheduleKind(scheduleResult.scheduleKind) && newGroupName.trim()) {
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
      setErr(e instanceof ApiError ? pharmacyErrorMessage(e, e.message) : "Save failed");
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
        {isAsNeededMedScheduleKind(scheduleDraft.scheduleKind) ? null : (
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
        )}
        <div className="space-y-2">
          <label className="block space-y-1 text-sm">
            <span>Pharmacy (optional)</span>
            <Select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}>
              <option value="">No pharmacy</option>
              {/* The one it has now, when it is no longer offered (archived since this list was loaded). */}
              {medication?.pharmacy && !pharmacies.some((p) => p.id === medication.pharmacy?.id) ? (
                <option value={medication.pharmacy.id}>
                  {medication.pharmacy.name}
                  {medication.pharmacy.archived ? " (archived)" : ""}
                </option>
              ) : null}
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          {canAddPharmacy && !readOnly ? (
            <label className="block space-y-1 text-sm">
              <span>+ New pharmacy (optional)</span>
              <Input
                value={newPharmacyName}
                onChange={(e) => setNewPharmacyName(e.target.value)}
                placeholder="Corner Drug"
                maxLength={200}
              />
            </label>
          ) : null}
        </div>
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
            excludeMemberIds={[memberId]}
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

