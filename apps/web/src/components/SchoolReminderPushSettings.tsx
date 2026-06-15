"use client";

import { useCallback, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import { ensurePushSubscribedWhenEnabling } from "../lib/web-push";
import { Alert, Checkbox } from "./ui";

export function SchoolReminderPushSettings({
  initialEnabled,
  pushAvailable,
}: {
  initialEnabled: boolean;
  pushAvailable: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const persist = useCallback(async (next: boolean) => {
    await apiClient.patch("/api/core/profile", { pushSchoolRemindersEnabled: next });
    setEnabled(next);
  }, []);

  async function onToggle(checked: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await persist(checked);
      if (checked) {
        const subscribed = await ensurePushSubscribedWhenEnabling();
        if (subscribed) {
          setMsg("School reminder push enabled on this device.");
        } else {
          setMsg("School reminder push enabled. Allow notifications in your browser to receive alerts.");
        }
      } else {
        setMsg("School reminder push disabled.");
      }
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not update preference");
      setEnabled(!checked);
    } finally {
      setBusy(false);
    }
  }

  if (!pushAvailable) return null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">School assignments</legend>
      <Checkbox
        label="Send push when assignments are due today or overdue"
        checked={enabled}
        disabled={busy}
        onChange={(e) => void onToggle(e.target.checked)}
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        Notifies enrolled students who have not submitted. Requires Web Push on this device.
      </p>
      {msg && (
        <Alert variant="success" className="text-sm">
          {msg}
        </Alert>
      )}
    </fieldset>
  );
}
