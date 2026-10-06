import { Alert } from "../ui";
import { count, finishSummary, rangeLabel, rangesLabel } from "./filling-helpers";
import type { SessionView } from "./filling-types";

/**
 * What a filling session did and what it left (WHO-428): shown before finishing, so nothing is left behind by accident,
 * and again afterwards as the record. Finishing creates no dose records: filling is not taking.
 */
export function FillingSummary({ session }: { session: Pick<SessionView, "medications" | "coverageStart" | "coverageEnd" | "status"> }) {
  const { filled, partial, pending, nothingToFill } = finishSummary(session);
  const done = session.status === "finished";
  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--color-text-muted)]">
        {rangeLabel({ from: session.coverageStart, to: session.coverageEnd })}
      </p>

      {filled.length > 0 ? (
        <section>
          <h4 className="font-medium text-[var(--color-text)]">Filled ({filled.length})</h4>
          <p className="break-words text-[var(--color-text-muted)]">{filled.map((m) => m.name).join(", ")}</p>
        </section>
      ) : null}

      {partial.length > 0 ? (
        <section>
          <h4 className="font-medium text-[var(--color-warning)]">Partly filled ({partial.length})</h4>
          <ul className="space-y-1 text-[var(--color-text-muted)]">
            {partial.map(({ medication, missing }) => (
              <li key={medication.medicationId} className="break-words">
                <span className="text-[var(--color-text)]">{medication.name}</span>: {count(medication.filledDays, "day")} of {medication.requiredDays} filled. Still to
                fill: {rangesLabel(missing)}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pending.length > 0 ? (
        <section>
          <h4 className="font-medium text-[var(--color-warning)]">Not filled ({pending.length})</h4>
          <p className="break-words text-[var(--color-text-muted)]">{pending.map((m) => m.name).join(", ")}</p>
        </section>
      ) : null}

      {nothingToFill.length > 0 ? (
        <section>
          <h4 className="font-medium text-[var(--color-text)]">Nothing to put in ({nothingToFill.length})</h4>
          <p className="break-words text-[var(--color-text-muted)]">{nothingToFill.map((m) => m.name).join(", ")}</p>
        </section>
      ) : null}

      <Alert variant="info">
        {done ? "This did not mark any doses as taken." : "Finishing does not mark any doses as taken."} Each fill already updated the medication&apos;s supply estimate.
      </Alert>
    </div>
  );
}
