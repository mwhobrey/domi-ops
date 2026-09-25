"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { zonedPartsFromIso } from "../../lib/schedule-conflict";
import { Alert, Button, Input, Select, Sheet } from "../ui";

export interface EditableDose {
  logId: string;
  medicationId: string;
  name: string;
  status: "taken" | "skipped" | "missed";
  /** null for an as-needed dose: no slot, so no taken/skipped choice. */
  scheduledAt: string | null;
  loggedAt: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  dose_time_conflict: "Another dose of this medication is already logged at that time.",
  logged_at_in_future: "That time hasn't happened yet.",
  invalid_logged_at: "Enter a date and time.",
};

/**
 * Fix a dose logged after the fact (WHO-340): set when it was really taken. Times are in the
 * household's zone, same as the rest of Health. The server moves interval slots to match.
 */
export function EditDoseSheet({
  dose,
  householdTimezone,
  onClose,
  onSaved,
}: {
  dose: EditableDose | null;
  householdTimezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [status, setStatus] = useState<EditableDose["status"]>("taken");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!dose) return;
    const parts = zonedPartsFromIso(dose.loggedAt, householdTimezone);
    setDate(parts.date);
    setTime(parts.time);
    setStatus(dose.status);
    setErr(null);
  }, [dose, householdTimezone]);

  async function save() {
    if (!dose) return;
    if (!date || !time) {
      setErr(ERROR_MESSAGES.invalid_logged_at);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiClient.patch(`/api/health/medications/${dose.medicationId}/logs/${dose.logId}`, {
        date,
        time,
        ...(status !== dose.status ? { status } : {}),
      });
      onSaved();
    } catch (e) {
      let code: string | undefined;
      if (e instanceof ApiError && e.body) {
        try {
          code = (JSON.parse(e.body) as { error?: string }).error;
        } catch {
          code = undefined;
        }
      }
      setErr((code && ERROR_MESSAGES[code]) ?? "Could not save the dose.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={dose !== null} onClose={onClose} title={dose ? `Edit ${dose.name}` : "Edit dose"}>
      <fieldset className="space-y-4 px-6 py-4">
        {err ? <Alert variant="error">{err}</Alert> : null}
        <p className="text-sm text-[var(--color-text-muted)]">
          Logged it late? Set when it was actually taken. The next dose on an interval schedule
          counts from this time.
        </p>
        <div className="flex gap-2">
          <label className="flex-1 space-y-1 text-sm">
            <span>{status === "taken" ? "Taken on" : "Date"}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex-1 space-y-1 text-sm">
            <span>Time</span>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        {dose?.scheduledAt ? (
          <label className="block space-y-1 text-sm">
            <span>Status</span>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as EditableDose["status"])}
            >
              <option value="taken">Taken</option>
              <option value="skipped">Skipped</option>
              {dose.status === "missed" ? <option value="missed">Missed</option> : null}
            </Select>
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </fieldset>
    </Sheet>
  );
}
