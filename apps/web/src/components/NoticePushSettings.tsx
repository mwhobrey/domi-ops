"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import {
  ensurePushSubscribedWhenEnabling,
  fetchPushConfig,
  isPushSupported,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
} from "../lib/web-push";
import { Alert, Button, Checkbox } from "./ui";

export function NoticePushSettings({
  initialEnabled,
  initialSubscribed,
  pushAvailable,
}: {
  initialEnabled: boolean;
  initialSubscribed: boolean;
  pushAvailable: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  /** Browser APIs are unavailable during SSR — detect only after mount to avoid hydration mismatch. */
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(isPushSupported());
  }, []);

  useEffect(() => {
    if (!pushAvailable || supported !== true) return;
    void fetchPushConfig().then((c) => {
      if (c.enabled && c.publicKey) setVapidKey(c.publicKey);
    });
  }, [pushAvailable, supported]);

  const persistEnabled = useCallback(async (next: boolean) => {
    await apiClient.patch("/api/core/profile", { pushNoticesEnabled: next });
    setEnabled(next);
  }, []);

  async function enableThisBrowser() {
    if (!vapidKey) {
      setMsg("Push is not configured on this server.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (!enabled) await persistEnabled(true);
      const ok = await subscribeBrowserPush(vapidKey);
      if (ok) {
        setSubscribed(true);
        setMsg("Notifications enabled for this browser.");
      } else {
        setMsg("Permission denied or not available.");
      }
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleEnabled(checked: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      if (!checked) {
        await unsubscribeBrowserPush();
        setSubscribed(false);
      }
      await persistEnabled(checked);
      // Was gated on Notification.permission === "granted" — on a real first-time device
      // (permission "default", never asked) that condition is false, so checking the box did
      // nothing but flip the preference: no prompt, no error, no subscription. Confirmed live:
      // "notifications already on" in the DB with zero rows in push_subscriptions.
      // ensurePushSubscribedWhenEnabling (already used correctly by the other push-settings
      // panels) handles "default" by actually requesting permission, not just syncing an
      // existing grant.
      if (checked && vapidKey && supported === true) {
        const ok = await ensurePushSubscribedWhenEnabling();
        setSubscribed(ok);
        if (!ok) setMsg("Permission denied or not available.");
      }
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not update preference");
      setEnabled(!checked);
    } finally {
      setBusy(false);
    }
  }

  if (!pushAvailable) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Browser notifications are not configured on this server (VAPID keys missing).
      </p>
    );
  }

  if (supported === null) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]" aria-busy="true">
        Checking notification support…
      </p>
    );
  }

  if (!supported) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        This browser does not support Web Push (install the app or use Chrome, Edge, or Firefox).
      </p>
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Notice notifications</legend>
      <Checkbox
        label="Send push notifications for new household notices"
        checked={enabled}
        disabled={busy}
        onChange={(e) => void onToggleEnabled(e.target.checked)}
      />
      {enabled && !subscribed && (
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void enableThisBrowser()}>
          Enable on this device
        </Button>
      )}
      {enabled && subscribed && (
        <p className="text-xs text-[var(--color-text-muted)]">This browser is subscribed.</p>
      )}
      {msg && (
        <Alert variant="success" className="text-sm">
          {msg}
        </Alert>
      )}
    </fieldset>
  );
}
