"use client";

import { useEffect, useState } from "react";
import type { NoteShareMember } from "../NoteSharePicker";
import { Alert, Button, Checkbox } from "../ui";
import type { OrganizerPlan } from "./organizer-types";

/**
 * Who is reminded when it is time to fill the organizer (WHO-427). Each person must be able to see this person's
 * medications; the server checks, and says so if one cannot.
 */
export function OrganizerPeopleStep({
  plan,
  members,
  save,
  onDone,
}: {
  plan: OrganizerPlan;
  members: readonly NoteShareMember[];
  save: (patch: Record<string, unknown>) => Promise<string | null>;
  onDone: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(plan.caregiverMemberIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setChosen(new Set(plan.caregiverMemberIds));
  }, [plan.version, plan.caregiverMemberIds]);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const message = await save({ caregiverMemberIds: [...chosen] });
      if (message) return setErr(message);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {err ? <Alert variant="error">{err}</Alert> : null}
      <p className="text-sm text-[var(--color-text-muted)]">
        These people are reminded at {plan.reminderTime} on the days it is time to fill the organizer. Leave everyone unticked for no reminders.
      </p>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.memberId}>
            <Checkbox
              checked={chosen.has(m.memberId)}
              onChange={(e) =>
                setChosen((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(m.memberId);
                  else next.delete(m.memberId);
                  return next;
                })
              }
              label={m.label}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button type="button" loading={busy} onClick={() => void submit()}>
          Save and finish
        </Button>
      </div>
    </div>
  );
}
