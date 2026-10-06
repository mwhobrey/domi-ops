"use client";

import { Button, Modal } from "../ui";
import { daysLeftLabel, formatDay } from "./supply-helpers";
import type { HealthMedication } from "./health-types";

/**
 * Shown when a medication comes back from a pause with an estimate that predates it (WHO-423). It was not
 * being taken while paused, so the run-out date is probably too early; the person says it is still right,
 * replaces it, or decides later (the card keeps a "Confirm estimate" badge until they do).
 */
export function SupplyConfirmDialog({
  medication,
  busy,
  error,
  onConfirm,
  onReplace,
  onLater,
}: {
  medication: HealthMedication | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onReplace: () => void;
  onLater: () => void;
}) {
  const supply = medication?.supply;
  return (
    <Modal
      open={medication !== null}
      onClose={onLater}
      title="Check the supply estimate"
      footer={
        <div className="flex flex-wrap justify-end gap-2 px-6 py-5">
          <Button variant="ghost" onClick={onLater} disabled={busy}>
            Later
          </Button>
          <Button variant="secondary" onClick={onReplace} disabled={busy}>
            Replace it
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            It&apos;s still right
          </Button>
        </div>
      }
    >
      <div className="space-y-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
        <p>
          <span className="font-medium text-[var(--color-text)]">{medication?.name}</span> was paused and is back. Its supply estimate was made
          before that.
        </p>
        {supply?.runsOutOn ? (
          <p>
            It says the supply runs out {formatDay(supply.runsOutOn)}
            {supply.daysRemaining !== null ? ` (${daysLeftLabel(supply.daysRemaining).toLowerCase()})` : ""}. Pills are not used while a medication is
            paused, so count what you have and replace it if that has changed.
          </p>
        ) : null}
        {error ? <p className="text-[var(--color-danger)]">{error}</p> : null}
      </div>
    </Modal>
  );
}
