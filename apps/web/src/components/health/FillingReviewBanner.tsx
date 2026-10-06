import { Alert, Button } from "../ui";
import { describeChanges } from "./filling-helpers";
import type { SessionView } from "./filling-types";

/**
 * Shown when the schedule, amounts or compartments changed after a session started (WHO-429). Filling waits for the
 * person to look at what changed and take the new instructions; what was already filled stays filled and is not touched.
 */
export function FillingReviewBanner({
  session,
  nameOf,
  busy,
  onReview,
}: {
  session: Pick<SessionView, "changes">;
  nameOf: (medicationId: string) => string;
  busy: boolean;
  onReview: () => void;
}) {
  const lines = describeChanges(session.changes, nameOf);
  return (
    <Alert variant="info" className="space-y-3">
      <p className="font-medium text-[var(--color-text)]">The instructions changed after this session started.</p>
      {lines.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-[var(--color-text-muted)]">
          {lines.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[var(--color-text-muted)]">
        Medications you already filled stay filled, and pills already in the organizer are not changed. Check any medication whose amount or compartment changed that you filled before. Days the schedule added show as still to fill.
      </p>
      <Button type="button" loading={busy} onClick={onReview}>
        Use the new instructions
      </Button>
    </Alert>
  );
}
