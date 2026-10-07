"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Input } from "../ui";
import { CompartmentDiagram } from "./CompartmentDiagram";
import {
  count,
  daysLeftAfter,
  defaultFillRange,
  fillEnd,
  fillErrorMessage,
  isStaleAnswer,
  missingAfter,
  newFillKey,
  rangeDays,
  rangeLabel,
  rangesLabel,
  sessionFromConflict,
  splitCovered,
  statusView,
} from "./filling-helpers";
import type { SessionMedication, SessionView } from "./filling-types";
import { formatPills } from "./organizer-helpers";
import { formatDay, parseDays, parsePreview, previewLabel, type SupplyPreview } from "./supply-helpers";

const MAX_DAYS = 3650;

/**
 * One medication being filled (WHO-428): what goes where, the days it covers (all of them, or fewer when the pills
 * run short), then how many days are left outside the organizers, with the run-out date shown before anything is saved.
 * Saving records the fill straight away; nothing waits for the end of the session.
 */
export function FillingMedicationPanel({
  planId,
  session,
  medication,
  reviewRequired,
  onBack,
  onSaved,
  onStale,
  onEdit,
}: {
  planId: string;
  session: SessionView;
  medication: SessionMedication;
  /** The instructions changed since the session started: nothing can be saved until they are reviewed. */
  reviewRequired: boolean;
  onBack: () => void;
  /** The fill was recorded: the session as it is now, and what to tell the person. */
  onSaved: (session: SessionView, message: string) => void;
  /** The server said the screen was out of date and sent the current session (or none): show it, with this message. */
  onStale: (session: SessionView | null, message: string) => void;
  /** Open this medication's editor on top of the screen (WHO-446), e.g. to fix a dosage written as one number. */
  onEdit?: (medicationId: string) => void;
}) {
  const range0 = useMemo(() => defaultFillRange(medication), [medication]);
  const covered = useMemo(() => splitCovered(medication.covered, { from: session.coverageStart, to: session.coverageEnd }), [medication.covered, session.coverageStart, session.coverageEnd]);
  const maxDays = range0 ? rangeDays(range0) : 0;
  const [daysText, setDaysText] = useState(String(maxDays));
  const [stage, setStage] = useState<"days" | "supply">("days");
  const [outsideText, setOutsideText] = useState("");
  const [totalText, setTotalText] = useState("");
  /** The organizers have a gap: stays on while the total is typed, so the field does not vanish under the person typing. */
  const [needsTotal, setNeedsTotal] = useState(false);
  const [onlySome, setOnlySome] = useState(false);
  const [preview, setPreview] = useState<{ result: SupplyPreview; key: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const keyRef = useRef(newFillKey());
  const supplyRef = useRef<HTMLDivElement>(null);
  const previewSeq = useRef(0);

  const days = parseDays(daysText, maxDays);
  const range = range0 && days !== null && days >= 1 ? { from: range0.from, to: fillEnd(range0.from, days, session.coverageEnd) } : null;
  const left = range ? daysLeftAfter(range, medication.missing) : 0;
  const leftover = range ? missingAfter(range, medication.missing) : [];
  const outsideDays = parseDays(outsideText, MAX_DAYS);
  const totalDays = parseDays(totalText, MAX_DAYS);
  const status = statusView(medication.status);

  // A different stretch is a different save: a retry of the same one keeps its key, a changed one gets its own.
  const rangeKey = range ? `${range.from}|${range.to}` : "";
  useEffect(() => {
    keyRef.current = newFillKey();
    setPreview(null);
    setNeedsTotal(false);
    setOnlySome(false);
  }, [rangeKey]);

  // A different number of days outside means the gap has to be found out again.
  useEffect(() => {
    setNeedsTotal(false);
  }, [outsideDays]);

  // The question appears below the fold on a phone: bring it up so the next tap is on the answer, not a scroll.
  useEffect(() => {
    if (stage === "supply") supplyRef.current?.scrollIntoView({ block: "center" });
  }, [stage]);

  const gap = needsTotal;
  const estimateReady = outsideDays !== null && (!gap || totalDays !== null);
  /** What the preview on screen was worked out for: a preview for other numbers does not count. */
  const inputsKey = `${rangeKey}|${outsideDays ?? ""}|${gap ? (totalDays ?? "") : ""}`;
  const base = `/api/health/organizers/${planId}/sessions/${session.id}/fills`;

  useEffect(() => {
    if (stage !== "supply" || !range || outsideDays === null) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    const sentFor = inputsKey;
    const handle = setTimeout(() => {
      apiClient
        .post<unknown>(base, {
          medicationId: medication.medicationId,
          coveredFrom: range.from,
          coveredTo: range.to,
          outsideDays,
          ...(gap && totalDays !== null ? { confirmedTotalDays: totalDays } : {}),
          idempotencyKey: keyRef.current,
          version: session.version,
          dryRun: true,
        })
        .then((res) => {
          if (seq !== previewSeq.current) return;
          const parsed = parsePreview(res);
          setPreview(parsed ? { result: parsed, key: sentFor } : null);
          if (parsed?.kind === "gap") setNeedsTotal(true);
          setPreviewError(null);
        })
        .catch((e) => {
          if (seq !== previewSeq.current) return;
          setPreview(null);
          if (isStaleAnswer(e)) onStale(sessionFromConflict(e), fillErrorMessage(e, "This session changed. It was reloaded."));
          else setPreviewError(fillErrorMessage(e, "Could not work out the run-out date. Change a number or try again."));
        });
    }, 350);
    return () => clearTimeout(handle);
    // The session's version is not a trigger: saving elsewhere should not re-run an estimate in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, rangeKey, outsideDays, totalDays, gap, medication.medicationId, base]);

  const daysInvalid = daysText.trim() !== "" && days === null;
  const outsideInvalid = outsideText.trim() !== "" && outsideDays === null;
  const incompleteOk = left === 0 || onlySome;
  const shown = preview && preview.key === inputsKey ? preview.result : null;
  const canSave = range !== null && estimateReady && incompleteOk && !busy && shown?.kind === "ok";

  async function save() {
    if (!range || outsideDays === null) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<{ session: SessionView; supply: { runsOutOn: string } }>(base, {
        medicationId: medication.medicationId,
        coveredFrom: range.from,
        coveredTo: range.to,
        outsideDays,
        ...(gap && totalDays !== null ? { confirmedTotalDays: totalDays } : {}),
        idempotencyKey: keyRef.current,
        version: session.version,
        dryRun: false,
      });
      const tail = res.supply?.runsOutOn ? ` Supply runs out ${formatDay(res.supply.runsOutOn)}.` : "";
      onSaved(res.session, `${medication.name} saved: ${rangeLabel(range)}.${tail}`);
    } catch (e) {
      if (isStaleAnswer(e)) onStale(sessionFromConflict(e), fillErrorMessage(e, "This session changed. It was reloaded."));
      else setErr(fillErrorMessage(e, "Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const fill = medication.lastFill;
    if (!fill) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<{ session: SessionView; supplyRestored?: boolean; unchanged?: boolean }>(`${base}/${fill.id}/undo`, { version: session.version });
      const days = rangeLabel({ from: fill.coveredFrom, to: fill.coveredTo });
      onSaved(
        res.session,
        res.unchanged
          ? `${medication.name}: the fill for ${days} had already been undone.`
          : res.supplyRestored
            ? `${medication.name}: the fill for ${days} was undone and the supply estimate put back.`
            : `${medication.name}: the fill for ${days} was undone. The supply estimate was changed since, so it was left as it is.`,
      );
    } catch (e) {
      setConfirmUndo(false);
      if (isStaleAnswer(e)) onStale(sessionFromConflict(e), fillErrorMessage(e, "This session changed. It was reloaded."));
      else setErr(fillErrorMessage(e, "Could not undo. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="secondary" size="sm" onClick={onBack}>
        ← All medications
      </Button>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-xl font-semibold text-[var(--color-text)]">{medication.name}</h3>
          <Badge tone={status.tone}>{status.label}</Badge>
          {onEdit ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(medication.medicationId)}>
              Edit medication
            </Button>
          ) : null}
        </div>
        {medication.dosage ? <p className="text-[var(--color-text-muted)]">{medication.dosage}</p> : null}
        {medication.instructions ? (
          <p className="whitespace-pre-line break-words rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text)]">
            {medication.instructions}
          </p>
        ) : null}
      </div>

      <p className="text-sm text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text)]">{formatPills(medication.totalPills)} pills</span> for {count(medication.requiredDays, "day")},{" "}
        {rangeLabel({ from: session.coverageStart, to: session.coverageEnd })}.
      </p>

      <CompartmentDiagram compartments={session.compartments} medication={medication} />

      {covered.inWindow.length > 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Filled so far: <span className="text-[var(--color-text)]">{rangesLabel(covered.inWindow)}</span> ({count(medication.filledDays, "day")} of {medication.requiredDays}).
        </p>
      ) : null}
      {covered.before.length > 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Already filled before this session: <span className="text-[var(--color-text)]">{rangesLabel(covered.before)}</span>.
        </p>
      ) : null}
      {covered.after.length > 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Already filled after this session: <span className="text-[var(--color-text)]">{rangesLabel(covered.after)}</span>.
        </p>
      ) : null}

      {medication.lastFill ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
          <span className="text-[var(--color-text-muted)]">
            Last saved: <span className="text-[var(--color-text)]">{rangeLabel({ from: medication.lastFill.coveredFrom, to: medication.lastFill.coveredTo })}</span>
          </span>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmUndo(true)}>
            Undo
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmUndo}
        title="Undo this fill?"
        message={`This takes back the last save for ${medication.name}. Its days go back to still to fill, and the supply estimate is put back as it was if nothing has changed it since.`}
        confirmLabel="Undo fill"
        loading={busy}
        onConfirm={() => void undo()}
        onCancel={() => setConfirmUndo(false)}
      />

      {!range0 ? (
        <Alert variant="success">Every day of this fill is done for {medication.name}.</Alert>
      ) : (
        <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-3">
          {err ? <Alert variant="error">{err}</Alert> : null}

          <label className="block space-y-1 text-sm">
            <span className="font-medium text-[var(--color-text)]">How many days did you fill?</span>
            <Input
              type="text"
              inputMode="numeric"
              value={daysText}
              disabled={stage === "supply"}
              error={daysInvalid ? `Enter 1 to ${maxDays}.` : undefined}
              onChange={(e) => setDaysText(e.target.value)}
              maxLength={3}
            />
            <span className="block text-xs text-[var(--color-text-muted)]">
              {range ? `${rangeLabel(range)} · ` : ""}Short on pills? Fill fewer days now and the rest later.
            </span>
          </label>

          {left > 0 ? (
            <Alert variant="info">
              {count(left, "day")} will still be empty: {rangesLabel(leftover)}. You can fill them when more arrives.
              <div className="mt-2">
                <Checkbox label="Yes, only these days for now" checked={onlySome} onChange={(e) => setOnlySome(e.target.checked)} />
              </div>
            </Alert>
          ) : null}

          {stage === "days" ? (
            <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap justify-end gap-2 rounded-b-lg border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-3">
              {reviewRequired ? <span className="mr-auto self-center text-xs text-[var(--color-text-muted)]">Use the new instructions first.</span> : null}
              <Button type="button" disabled={range === null || reviewRequired} onClick={() => setStage("supply")}>
                Filled. Next
              </Button>
            </div>
          ) : (
            <div ref={supplyRef} className="space-y-3 border-t border-[var(--color-border)] pt-3">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-[var(--color-text)]">How many days of {medication.name} are left outside the organizers?</span>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={outsideText}
                      error={outsideInvalid ? "Enter a whole number of days, from 0 to 3650." : undefined}
                      onChange={(e) => setOutsideText(e.target.value)}
                      maxLength={4}
                      autoFocus
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={() => setOutsideText("0")}>
                    None
                  </Button>
                </div>
                <span className="block text-xs text-[var(--color-text-muted)]">Bottles, boxes or refills you are keeping aside. Count what you have now.</span>
              </label>

              {gap ? (
                <div className="space-y-2" aria-live="polite">
                  <Alert variant="info">
                    The organizers have a gap
                    {preview?.result.kind === "gap" && preview.result.organizerEndsOn ? ` (filled through ${formatDay(preview.result.organizerEndsOn)}, then a break)` : ""}, so the days
                    can&apos;t be added up for you. Enter the total days you have in hand, organizers and all.
                  </Alert>
                  <label className="block space-y-1 text-sm">
                    <span>Total days in hand</span>
                    <Input type="text" inputMode="numeric" value={totalText} onChange={(e) => setTotalText(e.target.value)} maxLength={4} />
                  </label>
                </div>
              ) : null}

              <div aria-live="polite" className="min-h-6 text-sm">
                {shown?.kind === "ok" ? <p className="font-medium text-[var(--color-text)]">{previewLabel(shown)}</p> : null}
                {previewError ? <p className="text-[var(--color-danger)]">{previewError}</p> : null}
              </div>

              <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap justify-end gap-2 rounded-b-lg border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-3">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setStage("days")}>
                  Back
                </Button>
                <Button type="button" loading={busy} disabled={!canSave} onClick={() => void save()}>
                  Save this fill
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
