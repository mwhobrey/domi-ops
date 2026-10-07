"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Badge, Button } from "../ui";
import type { HealthMedication } from "./health-types";
import { QuantityInput } from "./QuantityInput";
import { formatPills, organizerErrorMessage, parseQuantityInput } from "./organizer-helpers";
import type { OrganizerPlan } from "./organizer-types";

type Draft = Record<string, Record<string, string>>;

const hhmm = (t: string) => t.slice(0, 5);

/** The dose times a medication takes: its own, plus any the plan says are missing a quantity. */
function timesFor(med: HealthMedication, plan: OrganizerPlan): string[] {
  const own = (med.schedule.times ?? []).map(hhmm);
  const flagged = plan.setup.problems.filter((p) => p.kind === "missing_quantity" && p.medicationId === med.id).map((p) => hhmm(p.time));
  return [...new Set([...own, ...flagged])].sort();
}

/**
 * How many pills go in at each dose time, medication by medication (WHO-427). The dosage text is shown for reference
 * ("10 mg") and is never used to fill the number in: milligrams are not pills.
 */
export function OrganizerQuantitiesStep({
  plan,
  medications,
  onEdit,
  onSaved,
  onDone,
}: {
  plan: OrganizerPlan;
  medications: readonly HealthMedication[];
  /** Open this medication's editor (WHO-446), e.g. to turn "600 mg" into 2 x 300 mg without leaving the setup. */
  onEdit?: (medicationId: string) => void;
  /** Called after quantities were saved, so the lists and the plan behind the sheet refresh. */
  onSaved: () => Promise<void> | void;
  onDone: () => void;
}) {
  // Medications that take fixed times and are on. Only the ones this person can change get fields; the rest are named below.
  const guided = useMemo(() => medications.filter((m) => m.scheduleKind === "scheduled" && m.enabled && (m.form ?? "pill") === "pill"), [medications]);
  const meds = useMemo(() => guided.filter((m) => m.canEdit !== false).sort((a, b) => a.name.localeCompare(b.name)), [guided]);
  const readOnly = useMemo(() => guided.filter((m) => m.canEdit === false).sort((a, b) => a.name.localeCompare(b.name)), [guided]);

  const initial = (): Draft => {
    const d: Draft = {};
    for (const m of meds) {
      d[m.id] = {};
      for (const t of timesFor(m, plan)) {
        const saved = m.doseQuantities?.[t];
        d[m.id]![t] = saved === undefined ? "" : formatPills(saved);
      }
    }
    return d;
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // What the saved amounts looked like last time, to tell what the person typed from what was just reloaded.
  const baseline = useRef<Draft | null>(null);
  useEffect(() => {
    const fresh = initial();
    const was = baseline.current;
    // Editing a medication reloads the list: keep amounts typed but not saved yet, take everything else from the server.
    setDraft((prev) => {
      if (!was) return fresh;
      const merged: Draft = {};
      for (const [id, times] of Object.entries(fresh)) {
        merged[id] = {};
        for (const [time, value] of Object.entries(times)) {
          const typed = prev[id]?.[time];
          const before = was[id]?.[time];
          merged[id]![time] = typed !== undefined && before !== undefined && typed !== before ? typed : value;
        }
      }
      return merged;
    });
    baseline.current = fresh;
    // Reset when the saved medications or the plan's problems change, not on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medications, plan.version]);

  const missing = (m: HealthMedication) => new Set(plan.setup.problems.filter((p) => p.kind === "missing_quantity" && p.medicationId === m.id).map((p) => hhmm(p.time)));

  async function submit() {
    setErr(null);
    const bad: Record<string, string> = {};
    const toSend: Array<{ med: HealthMedication; quantities: Record<string, number> }> = [];
    for (const m of meds) {
      const quantities: Record<string, number> = {};
      for (const [time, text] of Object.entries(draft[m.id] ?? {})) {
        if (text.trim() === "") continue;
        const parsed = parseQuantityInput(text);
        if (!parsed.ok) {
          bad[`${m.id}|${time}`] =
            parsed.reason === "not_quarter" ? "Use whole quarters: ¼, ½, ¾, 1, 1½ …" : parsed.reason === "range" ? "Use between ¼ and 100 pills." : "Enter a number of pills, like 1 or 1½.";
        } else quantities[time] = parsed.pills;
      }
      const before = m.doseQuantities ?? {};
      const same = Object.keys(quantities).length === Object.keys(before).length && Object.entries(quantities).every(([t, q]) => before[t] === q);
      if (!same) toSend.push({ med: m, quantities });
    }
    setErrors(bad);
    if (Object.keys(bad).length > 0) return setErr("Fix the amounts marked below.");

    setBusy(true);
    try {
      for (const { med, quantities } of toSend) {
        await apiClient.patch(`/api/health/medications/${med.id}`, { doseQuantities: quantities });
      }
      if (toSend.length > 0) await onSaved();
      onDone();
    } catch (e) {
      setErr(organizerErrorMessage(e, "Could not save the pill amounts. Try again."));
      // Some may have been saved before the one that failed: show what is true now.
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {err ? <Alert variant="error">{err}</Alert> : null}
      <p className="text-sm text-[var(--color-text-muted)]">
        How many pills go in at each time. Use quarters if you split pills: ¼, ½, 1½ … Leave a time blank if nothing goes in.
      </p>

      {meds.length === 0 ? (
        <Alert variant="info">No medications with fixed times yet. Medications taken as needed or every few hours are not part of the organizer.</Alert>
      ) : (
        <ul className="space-y-3">
          {meds.map((m) => {
            const flagged = missing(m);
            return (
              <li key={m.id} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 break-words font-medium text-[var(--color-text)]">
                    {m.name}
                    {m.dosage ? <span className="font-normal text-[var(--color-text-muted)]"> · {m.dosage}</span> : null}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {flagged.size > 0 ? <Badge tone="warning">Needs amounts</Badge> : null}
                    {onEdit ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(m.id)}>
                        Edit medication
                      </Button>
                    ) : null}
                  </div>
                </div>
                <ul className="space-y-2">
                  {Object.keys(draft[m.id] ?? {}).sort().map((time) => {
                    const key = `${m.id}|${time}`;
                    return (
                      <li key={time} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="w-14 shrink-0 tabular-nums text-sm text-[var(--color-text)]">{time}</span>
                        <div className="space-y-1">
                          <QuantityInput
                            value={draft[m.id]![time] ?? ""}
                            onChange={(next) => setDraft((prev) => ({ ...prev, [m.id]: { ...prev[m.id], [time]: next } }))}
                            label={`${m.name} at ${time}`}
                            invalid={Boolean(errors[key]) || (flagged.has(time) && (draft[m.id]![time] ?? "").trim() === "")}
                          />
                          {errors[key] ? <p className="text-xs text-[var(--color-danger)]">{errors[key]}</p> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {(m.doseQuantityIssues?.orphaned ?? []).length > 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    An amount is saved for {m.doseQuantityIssues!.orphaned.join(", ")}, which this medication no longer takes. It is ignored.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {readOnly.length > 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          You cannot change the pill amounts for {readOnly.map((m) => m.name).join(", ")}. Ask whoever manages {readOnly.length === 1 ? "it" : "them"}.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" loading={busy} onClick={() => void submit()}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}
