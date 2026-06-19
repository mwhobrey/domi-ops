"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import {
  fetchPushConfig,
  isPushSupported,
  subscribeBrowserPush,
  syncPushSubscription,
} from "../lib/web-push";
import { Alert, Button, Checkbox } from "./ui";

type PushPrefs = {
  pushNoticesEnabled: boolean;
  pushCalendarRemindersEnabled: boolean;
  pushChoresRemindersEnabled: boolean;
  pushExpenseBudgetAlertsEnabled: boolean;
  pushSchoolRemindersEnabled: boolean;
  pushShoppingRemindersEnabled: boolean;
  pushSubscribed: boolean;
  pushAvailable: boolean;
};

type TypeToggle = {
  id: string;
  legend: string;
  label: string;
  hint: string;
  field: keyof Pick<
    PushPrefs,
    | "pushNoticesEnabled"
    | "pushCalendarRemindersEnabled"
    | "pushChoresRemindersEnabled"
    | "pushExpenseBudgetAlertsEnabled"
    | "pushSchoolRemindersEnabled"
    | "pushShoppingRemindersEnabled"
  >;
  show: boolean;
};

function permissionLabel(): string {
  if (typeof window === "undefined" || !("Notification" in window)) return "unavailable";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return "not requested";
}

export function NotificationSettingsPanel({
  initial,
  modulesEnabled,
}: {
  initial: PushPrefs;
  modulesEnabled: string[];
}) {
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(isPushSupported());
  }, []);

  useEffect(() => {
    if (!initial.pushAvailable || supported !== true) return;
    void fetchPushConfig().then((c) => {
      if (c.enabled && c.publicKey) setVapidKey(c.publicKey);
    });
  }, [initial.pushAvailable, supported]);

  const persistField = useCallback(
    async (field: TypeToggle["field"], next: boolean) => {
      await apiClient.patch("/api/core/profile", { [field]: next });
      setPrefs((p) => ({ ...p, [field]: next }));
    },
    [],
  );

  async function enableThisDevice() {
    if (!vapidKey) {
      setMsg("Push is not configured on this server.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const ok = await subscribeBrowserPush(vapidKey);
      if (ok) {
        setPrefs((p) => ({ ...p, pushSubscribed: true }));
        setMsg("This browser is subscribed for notifications.");
      } else {
        setMsg("Permission denied or not available in this browser.");
      }
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function onTypeToggle(field: TypeToggle["field"], checked: boolean) {
    setBusy(true);
    setMsg(null);
    const prev = prefs[field];
    try {
      await persistField(field, checked);
      if (checked) {
        const subscribed = await ensureDeviceSubscribed(vapidKey, supported === true);
        if (subscribed) setPrefs((p) => ({ ...p, pushSubscribed: true }));
      }
      setMsg(checked ? "Preference saved." : "Notifications disabled for this type.");
    } catch (err) {
      setPrefs((p) => ({ ...p, [field]: prev }));
      setMsg(err instanceof ApiError ? err.message : "Could not update preference");
    } finally {
      setBusy(false);
    }
  }

  const types: TypeToggle[] = [
    {
      id: "notices",
      legend: "Notice notifications",
      label: "Send push notifications for new household notices",
      hint: "Opens the notice board when tapped.",
      field: "pushNoticesEnabled",
      show: true,
    },
    {
      id: "calendar",
      legend: "Calendar reminders",
      label: "Send push notifications before upcoming calendar events",
      hint: "Tap opens the event in the calendar.",
      field: "pushCalendarRemindersEnabled",
      show: modulesEnabled.includes("calendar_sync"),
    },
    {
      id: "chores",
      legend: "Chore reminders",
      label: "Send push when chores are due tomorrow or overdue (due-today summary at 8:00 local)",
      hint: "Due-today chores arrive as one morning digest; tomorrow and overdue are individual alerts.",
      field: "pushChoresRemindersEnabled",
      show: true,
    },
    {
      id: "budgets",
      legend: "Expense budgets",
      label: "Send push when a category nears or exceeds its monthly budget",
      hint: "Alerts at 80% and 100% of target, once per month per category.",
      field: "pushExpenseBudgetAlertsEnabled",
      show: true,
    },
    {
      id: "school",
      legend: "School assignments",
      label: "Send push when assignments are due today or overdue",
      hint: "Notifies enrolled students who have not submitted work.",
      field: "pushSchoolRemindersEnabled",
      show: modulesEnabled.includes("school"),
    },
    {
      id: "shopping",
      legend: "Shopping lists",
      label: "Send push when recurring shopping items are added to the list",
      hint: "Fires when a recurring template materializes new items on list load.",
      field: "pushShoppingRemindersEnabled",
      show: true,
    },
  ];

  if (!initial.pushAvailable) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Browser notifications are not configured on this server (VAPID keys missing). Ask a
        household admin to set <code className="text-xs">VAPID_*</code> in the server environment.
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
        This browser does not support Web Push. Install the whome app (PWA) or use Chrome, Edge, or
        Firefox.
      </p>
    );
  }

  const perm = permissionLabel();
  const anyTypeEnabled =
    prefs.pushNoticesEnabled ||
    prefs.pushCalendarRemindersEnabled ||
    prefs.pushChoresRemindersEnabled ||
    prefs.pushExpenseBudgetAlertsEnabled ||
    prefs.pushSchoolRemindersEnabled ||
    prefs.pushShoppingRemindersEnabled;

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">This device</legend>
        <p className="text-sm text-[var(--color-text-muted)]">
          Permission: <span className="font-medium text-[var(--color-text)]">{perm}</span>
          {prefs.pushSubscribed ? " · Subscribed" : " · Not subscribed"}
        </p>
        {perm === "denied" ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Notifications are blocked in your browser. Reset the permission in site settings, or on
            iOS install the app to Home Screen first (iOS 16.4+).
          </p>
        ) : null}
        {!prefs.pushSubscribed && anyTypeEnabled ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busy}
            className="min-h-11"
            onClick={() => void enableThisDevice()}
          >
            Enable on this device
          </Button>
        ) : null}
      </fieldset>

      {types
        .filter((t) => t.show)
        .map((t) => (
          <fieldset key={t.id} className="space-y-3">
            <legend className="text-sm font-medium">{t.legend}</legend>
            <Checkbox
              label={t.label}
              checked={prefs[t.field]}
              disabled={busy}
              onChange={(e) => void onTypeToggle(t.field, e.target.checked)}
            />
            <p className="text-xs text-[var(--color-text-muted)]">{t.hint}</p>
          </fieldset>
        ))}

      {msg ? (
        <Alert variant="success" className="text-sm">
          {msg}
        </Alert>
      ) : null}
    </div>
  );
}

async function ensureDeviceSubscribed(
  vapidKey: string | null,
  supported: boolean,
): Promise<boolean> {
  if (!supported || !vapidKey) return false;
  if (Notification.permission === "granted") {
    return syncPushSubscription(vapidKey);
  }
  if (Notification.permission === "default") {
    return subscribeBrowserPush(vapidKey);
  }
  return false;
}
