"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Button, Input, Select, Sheet } from "../ui";
import type { HealthMedication } from "./health-types";
import type { Pharmacy } from "./supply-types";
import {
  daysLeftLabel,
  formatDay,
  parseDays,
  parsePreview,
  previewLabel,
  supplyErrorMessage,
  type SupplyPreview,
} from "./supply-helpers";

const MAX_DAYS = 3650;
const MAX_LEAD = 90;

type Mode = "set" | "receive";

/**
 * Set a medication's supply, or record that a refill arrived (WHO-422).
 *
 * The person types how many days of pills they have OUTSIDE the organizers; the server adds what the
 * organizers still hold. A dry run shows the run-out date as they type, and when the organizers have a gap
 * it asks for the total days in hand instead. Receiving takes the new total and closes the open request.
 */
export function SupplySheet({
  open,
  mode,
  medication,
  defaultLeadDays,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  medication: HealthMedication | null;
  /** The person's default refill lead time, shown as what a blank override means. */
  defaultLeadDays: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supply = medication?.supply;
  const [outsideText, setOutsideText] = useState("");
  const [totalText, setTotalText] = useState("");
  const [pharmacyId, setPharmacyId] = useState("");
  const [leadText, setLeadText] = useState("");
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [preview, setPreview] = useState<SupplyPreview | null>(null);
  /** The organizers have a gap for these days. It stays on while the total in hand is typed, even though the
   *  preview then turns into a normal estimate, so the total field does not vanish under the person typing. */
  const [needsTotal, setNeedsTotal] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const previewSeq = useRef(0);

  const outsideDays = parseDays(outsideText, MAX_DAYS);
  const totalDays = parseDays(totalText, MAX_DAYS);
  const gap = needsTotal;

  useEffect(() => {
    if (!open) return;
    setOutsideText("");
    setTotalText("");
    setPharmacyId(medication?.pharmacy?.id ?? "");
    setLeadText(supply?.leadDaysOverride !== null && supply?.leadDaysOverride !== undefined ? String(supply.leadDaysOverride) : "");
    setPreview(null);
    setNeedsTotal(false);
    setPreviewError(null);
    setErr(null);
    keyRef.current = null;
  }, [open, medication, supply?.leadDaysOverride]);

  // A different number of days outside means the gap has to be found out again.
  useEffect(() => {
    setNeedsTotal(false);
  }, [outsideDays]);

  // A new key whenever the form changes, so a retried save is only ever "the same submission" when nothing differs.
  useEffect(() => {
    keyRef.current = null;
  }, [outsideText, totalText, pharmacyId, leadText]);

  useEffect(() => {
    if (!open || mode !== "set") return;
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
  }, [open, mode]);

  // The live preview: ask the server (dry run) what these days come to, once the typing settles.
  useEffect(() => {
    if (!open || !medication || outsideDays === null) {
      previewSeq.current += 1;
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const seq = ++previewSeq.current;
    const handle = setTimeout(() => {
      const body = { outsideDays, ...(totalDays !== null ? { confirmedTotalDays: totalDays } : {}), dryRun: true };
      const call =
        mode === "set"
          ? apiClient.put<unknown>(`/api/health/medications/${medication.id}/supply`, body)
          : apiClient.post<unknown>(`/api/health/medications/${medication.id}/supply/receive`, body);
      call
        .then((res) => {
          if (seq !== previewSeq.current) return;
          const parsed = parsePreview(res);
          setPreview(parsed);
          if (parsed?.kind === "gap") setNeedsTotal(true);
          setPreviewError(null);
        })
        .catch((e) => {
          if (seq !== previewSeq.current) return;
          setPreview(null);
          setPreviewError(supplyErrorMessage(e, "Could not work out the run-out date."));
        });
    }, 350);
    return () => clearTimeout(handle);
  }, [open, medication, mode, outsideDays, totalDays]);

  const leadParsed = leadText.trim() === "" ? null : parseDays(leadText, MAX_LEAD);
  const leadInvalid = leadText.trim() !== "" && leadParsed === null;
  const leadChanged = leadParsed !== (supply?.leadDaysOverride ?? null);
  const pharmacyChanged = pharmacyId !== (medication?.pharmacy?.id ?? "");
  const estimateReady = outsideDays !== null && (!gap || totalDays !== null);
  const outsideInvalid = outsideText.trim() !== "" && outsideDays === null;

  const canSave =
    mode === "receive"
      ? estimateReady && !previewError
      : !leadInvalid && !outsideInvalid && (outsideText.trim() === "" || (estimateReady && !previewError)) && (outsideText.trim() !== "" || leadChanged || pharmacyChanged);

  async function save() {
    if (!medication || !canSave) return;
    setBusy(true);
    setErr(null);
    keyRef.current ??= crypto.randomUUID();
    try {
      if (mode === "receive") {
        await apiClient.post(`/api/health/medications/${medication.id}/supply/receive`, {
          outsideDays,
          ...(gap && totalDays !== null ? { confirmedTotalDays: totalDays } : {}),
          idempotencyKey: keyRef.current,
        });
      } else {
        await apiClient.put(`/api/health/medications/${medication.id}/supply`, {
          ...(outsideDays !== null ? { outsideDays } : {}),
          ...(outsideDays !== null && gap && totalDays !== null ? { confirmedTotalDays: totalDays } : {}),
          ...(leadChanged ? { leadDays: leadParsed } : {}),
          ...(pharmacyChanged ? { pharmacyId: pharmacyId || null } : {}),
          ...(supply ? { version: supply.version } : {}),
          idempotencyKey: keyRef.current,
        });
      }
      onSaved();
    } catch (e) {
      setErr(supplyErrorMessage(e, "Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  // After a resume the old estimate is stale; confirming says it is still right.
  async function confirmEstimate() {
    if (!medication || !supply) return;
    setBusy(true);
    setErr(null);
    try {
      await apiClient.put(`/api/health/medications/${medication.id}/supply`, {
        confirm: true,
        version: supply.version,
        idempotencyKey: crypto.randomUUID(),
      });
      onSaved();
    } catch (e) {
      setErr(supplyErrorMessage(e, "Could not confirm the estimate."));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "receive" ? "Mark received" : "Set supply";

  return (
    <Sheet open={open} onClose={onClose} title={medication ? `${title} · ${medication.name}` : title}>
      <form
        className="space-y-4 px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {err ? <Alert variant="error">{err}</Alert> : null}

        {mode === "set" && supply?.needsConfirmation ? (
          <Alert variant="info">
            <div className="space-y-2">
              <p>This medication was paused and resumed since its estimate was made. Is it still right?</p>
              <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void confirmEstimate()}>
                Yes, the estimate is still right
              </Button>
            </div>
          </Alert>
        ) : null}

        {supply?.runsOutOn ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Now: runs out {formatDay(supply.runsOutOn)}
            {supply.daysRemaining !== null ? ` · ${daysLeftLabel(supply.daysRemaining)}` : ""}
          </p>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span>{mode === "receive" ? "Days of pills you now have outside the organizers" : "Days of pills outside the organizers, right now"}</span>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={outsideText}
            onChange={(e) => setOutsideText(e.target.value)}
            placeholder={mode === "receive" ? "e.g. 90" : "Leave blank to keep the current estimate"}
            maxLength={4}
            autoFocus
          />
        </label>
        {outsideInvalid ? <p className="text-sm text-[var(--color-danger)]">Enter a whole number of days, from 0 to {MAX_DAYS}.</p> : null}

        {preview?.kind === "ok" ? (
          <p className="rounded-lg bg-[var(--color-surface-secondary)] px-3 py-2 text-sm text-[var(--color-text)]" aria-live="polite">
            {previewLabel(preview)}
          </p>
        ) : null}
        {previewError ? <p className="text-sm text-[var(--color-danger)]">{previewError}</p> : null}

        {gap ? (
          <div className="space-y-2" aria-live="polite">
            <Alert variant="info">
              The organizers have a gap
              {preview?.kind === "gap" && preview.organizerEndsOn ? ` (filled through ${formatDay(preview.organizerEndsOn)}, then a break)` : ""}, so
              the days can&apos;t be added up for you. Enter the total days you have in hand, organizers and all.
            </Alert>
            <label className="block space-y-1 text-sm">
              <span>Total days in hand</span>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={totalText}
                onChange={(e) => setTotalText(e.target.value)}
                maxLength={4}
              />
            </label>
          </div>
        ) : null}

        {mode === "set" ? (
          <>
            <label className="block space-y-1 text-sm">
              <span>Pharmacy (optional)</span>
              <Select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}>
                <option value="">No pharmacy</option>
                {medication?.pharmacy && !pharmacies.some((p) => p.id === medication.pharmacy?.id) ? (
                  <option value={medication.pharmacy.id}>{medication.pharmacy.name} (archived)</option>
                ) : null}
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Remind me this many days before it runs out</span>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={leadText}
                onChange={(e) => setLeadText(e.target.value)}
                placeholder={`Default (${defaultLeadDays})`}
                maxLength={2}
              />
            </label>
            {leadInvalid ? <p className="text-sm text-[var(--color-danger)]">Enter a whole number of days, from 0 to {MAX_LEAD}.</p> : null}
          </>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!canSave}>
            {mode === "receive" ? "Mark received" : "Save"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
