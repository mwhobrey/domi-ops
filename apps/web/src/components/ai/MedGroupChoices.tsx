"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { connectionError, type MedGroupChoice, type OwnMedGroup } from "../../lib/mcp";
import { Button, Checkbox, Input } from "../ui";

/**
 * Lets a member pick which of their own medication groups an assistant may see. Medication names
 * appear here for the member only; what is sent is the label, the times and a logging status.
 */
export function MedGroupChoices({ idPrefix, householdId, allowLog, value, onChange, disabled, isNew }: {
  idPrefix: string; householdId: string; allowLog: boolean; value: MedGroupChoice[]; onChange: (choices: MedGroupChoice[]) => void; disabled: boolean;
  /** Medications added to a shared group since the member last approved it. */
  isNew?: (groupId: string, medicationId: string) => boolean;
}) {
  const [groups, setGroups] = useState<OwnMedGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ open: boolean; loading: boolean; text: string | null; error: string | null }>({ open: false, loading: false, text: null, error: null });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await apiClient.post<{ groups: OwnMedGroup[] }>("/api/mcp-auth/health-groups", { householdId });
        if (!cancelled) setGroups(result.groups);
      } catch (e) { if (!cancelled) setError(connectionError(e)); }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  // A preview belongs to the choices it was requested for; any change or close drops a response still in flight.
  const turn = useRef(0);
  const update = (groupId: string, change: Partial<MedGroupChoice>) => { turn.current++; setPreview((state) => ({ ...state, open: false })); onChange(value.map((choice) => choice.groupId === groupId ? { ...choice, ...change } : choice)); };
  function toggle(groupId: string, shared: boolean) {
    turn.current++;
    setPreview((state) => ({ ...state, open: false }));
    onChange(shared ? [...value, { groupId, canLog: false, shareCounts: true, alias: null, excludedMedicationIds: [] }] : value.filter((choice) => choice.groupId !== groupId));
  }
  async function togglePreview() {
    const current = ++turn.current;
    if (preview.open) { setPreview({ ...preview, open: false }); return; }
    setPreview({ open: true, loading: true, text: null, error: null });
    try {
      const result = await apiClient.post<{ payload: unknown }>("/api/mcp-auth/health-groups/preview", { householdId, groups: value });
      if (turn.current === current) setPreview({ open: true, loading: false, text: JSON.stringify(result.payload, null, 2), error: null });
    } catch (e) { if (turn.current === current) setPreview({ open: true, loading: false, text: null, error: connectionError(e) }); }
  }

  if (error) return <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>;
  if (!groups) return <p role="status" className="text-sm">Loading your medication groups…</p>;
  if (!groups.length) return <p className="text-sm text-[var(--color-text-muted)]">You have no medication groups with set times. Create one in Health, then come back to share it.</p>;
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <legend className="font-medium">Medication groups to share ({value.length})</legend>
    <p className="text-sm text-[var(--color-text-muted)]">Nothing is shared unless you tick it. The assistant gets each group’s label, its times and whether it has been logged. The medication name, strength, instruction and history fields are never sent; the names below are shown only to you. The label is sent as you write it.</p>
    {groups.map((group) => {
      const choice = value.find((entry) => entry.groupId === group.id), id = `${idPrefix}-group-${group.id}`;
      const added = choice && isNew ? group.medications.filter((med) => isNew(group.id, med.id)).length : 0;
      return <div key={group.id} className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
        <Checkbox id={id} checked={Boolean(choice)} onChange={(e) => toggle(group.id, e.target.checked)}
          label={`${group.name || "Unnamed group"}${group.times.length ? ` · ${group.times.join(", ")}` : ""}${group.enabled ? "" : " · paused"}`} />
        {choice && <div className="space-y-3 pl-6">
          <div className="space-y-1">
            <label htmlFor={`${id}-label`} className="text-sm">Label the assistant will see</label>
            <Input id={`${id}-label`} maxLength={40} value={choice.alias ?? group.name} onChange={(e) => update(group.id, { alias: e.target.value === group.name ? null : e.target.value })} />
            <p className="text-xs text-[var(--color-text-muted)]">Change it if the group’s name says more than you want to share, such as a medication name. This label is sent to the assistant.</p>
            {choice.alias !== null && choice.alias !== undefined && !choice.alias.trim() && <p role="alert" className="rounded-xl border border-[var(--color-warning)] p-3 text-sm">A blank label is not shared as blank: the assistant would see the group’s own name, “{group.name || "Medication group"}”. Type the label you want it to see.</p>}
          </div>
          {allowLog && <Checkbox id={`${id}-log`} checked={choice.canLog} onChange={(e) => update(group.id, { canLog: e.target.checked })} label="Let the assistant record this group as taken when I say I took it" />}
          <Checkbox id={`${id}-counts`} checked={choice.shareCounts} onChange={(e) => update(group.id, { shareCounts: e.target.checked })} label="Share how many medications are in this group" />
          <div className="space-y-2">
            <p className="text-sm font-medium">Medications this covers</p>
            {added > 0 && <p role="note" className="rounded-xl border border-[var(--color-warning)] p-3 text-sm">{added === 1 ? "1 medication was" : `${added} medications were`} added to this group since you approved this assistant. Saving approves every ticked medication below.</p>}
            {!group.medications.length && <p className="text-sm text-[var(--color-text-muted)]">This group has no medications yet.</p>}
            {group.medications.map((med) => <Checkbox key={med.id} id={`${id}-med-${med.id}`} checked={!choice.excludedMedicationIds.includes(med.id)}
              label={`${med.name || "Unnamed medication"}${med.paused ? " (paused)" : ""}${isNew?.(group.id, med.id) ? " (new)" : ""}`}
              onChange={(e) => update(group.id, { excludedMedicationIds: e.target.checked ? choice.excludedMedicationIds.filter((entry) => entry !== med.id) : [...choice.excludedMedicationIds, med.id] })} />)}
            <p className="text-xs text-[var(--color-text-muted)]">An unticked medication is never logged by the assistant. A medication you add to the group later is not covered until you approve it here.</p>
          </div>
        </div>}
      </div>;
    })}
    {value.length > 0 && <div className="space-y-2">
      <Button type="button" variant="secondary" aria-expanded={preview.open} onClick={() => void togglePreview()}>{preview.open ? "Hide what the assistant receives" : "See what the assistant receives"}</Button>
      {preview.open && preview.loading && <p role="status" className="text-sm">Loading today’s schedule…</p>}
      {preview.open && preview.error && <p role="alert" className="text-sm text-[var(--color-danger)]">{preview.error}</p>}
      {preview.open && preview.text && <>
        <p className="text-xs text-[var(--color-text-muted)]">This is the exact response for today with the choices above. Nothing has been sent.</p>
        <pre tabIndex={0} aria-label="Exact assistant response for medication groups" className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-[var(--color-border)] p-3 text-xs">{preview.text}</pre>
      </>}
    </div>}
  </fieldset>;
}
