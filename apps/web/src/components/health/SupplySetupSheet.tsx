"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Badge, Button, Input, Select, Sheet } from "../ui";
import type { HealthMedication } from "./health-types";
import { medsNeedingSetup, planSetupRow, supplyErrorMessage } from "./supply-helpers";
import { apiErrorCode } from "./pharmacy-helpers";
import type { Pharmacy } from "./supply-types";

type Row = { medication: HealthMedication; daysText: string; pharmacyId: string };
type RowResult = { state: "saved" } | { state: "error"; message: string };

/**
 * First-run setup (WHO-423): the person's medications that have no supply estimate yet, each with a days
 * field and a pharmacy, saved in one pass of ordinary supply updates.
 *
 * Safe to stop and come back: every row is its own update, a row that saved now has an estimate and drops
 * out of the list the next time, and a row that failed or was left blank stays for later. Nothing here
 * guesses: a blank row is simply skipped.
 */
export function SupplySetupSheet({
  open,
  memberLabelText,
  medications,
  onClose,
  onSaved,
}: {
  open: boolean;
  memberLabelText: string;
  /** The person's medications; the ones still needing an estimate are picked out when the sheet opens. */
  medications: HealthMedication[];
  onClose: () => void;
  /** Called after every pass that saved something, so the lists behind the sheet refresh without closing it. */
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    if (!open) return;
    setRows(medsNeedingSetup(medications).map((m) => ({ medication: m, daysText: "", pharmacyId: m.pharmacy?.id ?? "" })));
    setResults({});
    setSummary(null);
    keys.current = new Map();
    // Only when it opens: the list on screen must not reshuffle under someone who is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .get<{ pharmacies: Pharmacy[] }>("/api/health/pharmacies")
      .then((res) => {
        if (!cancelled) setPharmacies(res.pharmacies);
      })
      .catch(() => {
        if (!cancelled) setPharmacies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function update(id: string, patch: Partial<Pick<Row, "daysText" | "pharmacyId">>) {
    keys.current.delete(id); // a changed row is a new submission
    setRows((prev) => prev.map((r) => (r.medication.id === id ? { ...r, ...patch } : r)));
    setResults((prev) => {
      if (!prev[id] || prev[id]!.state === "saved") return prev;
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
  }

  const pending = rows.filter((r) => results[r.medication.id]?.state !== "saved");
  const plans = pending.map((r) => ({ row: r, plan: planSetupRow({ daysText: r.daysText, pharmacyId: r.pharmacyId, originalPharmacyId: r.medication.pharmacy?.id ?? "" }) }));
  const toSave = plans.filter((p) => p.plan.kind === "save");
  const hasInvalid = plans.some((p) => p.plan.kind === "invalid");

  async function save() {
    if (busy || hasInvalid || toSave.length === 0) return;
    setBusy(true);
    setSummary(null);
    let saved = 0;
    const next: Record<string, RowResult> = { ...results };
    for (const { row, plan } of toSave) {
      if (plan.kind !== "save") continue;
      const id = row.medication.id;
      const key = keys.current.get(id) ?? crypto.randomUUID();
      keys.current.set(id, key);
      try {
        await apiClient.put(`/api/health/medications/${id}/supply`, {
          ...plan.body,
          ...(row.medication.supply ? { version: row.medication.supply.version } : {}),
          idempotencyKey: key,
        });
        next[id] = { state: "saved" };
        saved += 1;
      } catch (e) {
        next[id] = {
          state: "error",
          message:
            apiErrorCode(e) === "confirmation_required"
              ? "The organizers have a gap for this one. Close this and use Set supply on it."
              : supplyErrorMessage(e, "Could not save this one."),
        };
      }
    }
    setResults(next);
    setBusy(false);
    const failed = toSave.length - saved;
    setSummary(
      failed === 0
        ? `Saved ${saved}.`
        : `Saved ${saved}. ${failed} did not save: fix those and press Save again, or leave them for later.`,
    );
    if (saved > 0) onSaved();
  }

  function applyPharmacyToAll(id: string) {
    keys.current = new Map();
    setRows((prev) => prev.map((r) => (results[r.medication.id]?.state === "saved" ? r : { ...r, pharmacyId: id })));
  }

  const allSaved = rows.length > 0 && rows.every((r) => results[r.medication.id]?.state === "saved");

  return (
    <Sheet open={open} onClose={onClose} title={`Set up supply · ${memberLabelText}`}>
      <div className="space-y-4 px-6 py-4">
        <p className="text-sm text-[var(--color-text-muted)]">
          For each medication, enter how many days of pills you have on hand right now. This is an estimate you confirm, not a count that
          follows every dose, and logging a dose never changes it. Leave a row blank to skip it; you can come back to it later.
        </p>

        {summary ? <Alert variant={summary.includes("did not save") ? "error" : "success"}>{summary}</Alert> : null}

        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text)]">Every medication already has a supply estimate.</p>
        ) : (
          <>
            {pharmacies.length > 0 ? (
              <label className="block space-y-1 text-sm">
                <span>Pharmacy for all of them (optional)</span>
                <Select value="" onChange={(e) => e.target.value && applyPharmacyToAll(e.target.value)}>
                  <option value="">Choose to fill in every row…</option>
                  {pharmacies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}

            <ul className="space-y-3">
              {rows.map((row) => {
                const id = row.medication.id;
                const result = results[id];
                const plan = plans.find((p) => p.row.medication.id === id)?.plan;
                const saved = result?.state === "saved";
                return (
                  <li key={id} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 break-words font-medium text-[var(--color-text)]">
                        {row.medication.name}
                        {row.medication.dosage ? <span className="font-normal text-[var(--color-text-muted)]"> · {row.medication.dosage}</span> : null}
                      </p>
                      {saved ? <Badge tone="success">Saved</Badge> : null}
                    </div>
                    {saved ? null : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block space-y-1 text-sm">
                          <span>Days on hand</span>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={row.daysText}
                            onChange={(e) => update(id, { daysText: e.target.value })}
                            placeholder="Skip"
                            maxLength={4}
                            aria-label={`Days of ${row.medication.name} on hand`}
                          />
                        </label>
                        <label className="block space-y-1 text-sm">
                          <span>Pharmacy</span>
                          <Select
                            value={row.pharmacyId}
                            onChange={(e) => update(id, { pharmacyId: e.target.value })}
                            aria-label={`Pharmacy for ${row.medication.name}`}
                          >
                            <option value="">No pharmacy</option>
                            {row.medication.pharmacy && !pharmacies.some((p) => p.id === row.medication.pharmacy?.id) ? (
                              <option value={row.medication.pharmacy.id}>{row.medication.pharmacy.name} (archived)</option>
                            ) : null}
                            {pharmacies.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                        </label>
                      </div>
                    )}
                    {plan?.kind === "invalid" && !saved ? (
                      <p className="text-sm text-[var(--color-danger)]">Enter a whole number of days, from 0 to 3650, or leave it blank.</p>
                    ) : null}
                    {result?.state === "error" ? <p className="text-sm text-[var(--color-danger)]">{result.message}</p> : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {allSaved || rows.length === 0 ? "Done" : "Close"}
          </Button>
          {rows.length > 0 && !allSaved ? (
            <Button type="button" loading={busy} disabled={hasInvalid || toSave.length === 0} onClick={() => void save()}>
              {toSave.length > 0 ? `Save ${toSave.length}` : "Save"}
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
