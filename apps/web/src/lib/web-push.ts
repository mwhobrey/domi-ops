import { apiClient } from "./client-api";
import { getCapacitorPlugin } from "./capacitor-bridge";
import { isNativeShell, nativePlatform } from "./native-shell";

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushNotificationsPlugin = {
  requestPermissions: () => Promise<{ receive?: string }>;
  register: () => Promise<void>;
  addListener: (
    event: "registration" | "registrationError",
    cb: (payload: { value?: string; error?: string }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void };
};

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeShell()) {
    return Boolean(getCapacitorPlugin("PushNotifications"));
  }
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function fetchPushConfig(): Promise<{ enabled: boolean; publicKey: string | null }> {
  try {
    return await apiClient.get<{ enabled: boolean; publicKey: string | null }>(
      "/api/core/push/vapid-public-key",
    );
  } catch {
    return { enabled: false, publicKey: null };
  }
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return reg;
}

async function subscribeNativePush(): Promise<boolean> {
  const platform = nativePlatform();
  if (platform !== "ios" && platform !== "android") return false;
  const Push = getCapacitorPlugin<PushNotificationsPlugin>("PushNotifications");
  if (!Push) return false;

  const perm = await Push.requestPermissions();
  if (perm.receive !== "granted") return false;

  const token = await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    void Promise.resolve(
      Push.addListener("registration", (ev) => {
        finish(typeof ev.value === "string" ? ev.value : null);
      }),
    );
    void Promise.resolve(
      Push.addListener("registrationError", () => {
        finish(null);
      }),
    );

    void Push.register().catch(() => finish(null));
    setTimeout(() => finish(null), 15000);
  });

  if (!token) return false;

  await apiClient.post("/api/core/push/native-subscribe", {
    platform,
    deviceToken: token,
    timezone: deviceTimezone(),
  });
  return true;
}

export async function subscribeBrowserPush(publicKey: string): Promise<boolean> {
  if (isNativeShell()) return subscribeNativePush();
  if (!isPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await serviceWorkerRegistration();
  if (!reg?.pushManager) return false;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  await apiClient.post("/api/core/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    timezone: deviceTimezone(),
  });
  return true;
}

export async function unsubscribeBrowserPush(): Promise<void> {
  if (isNativeShell()) {
    const platform = nativePlatform();
    // Best-effort: remove all native rows for this user on this device family.
    // Token is not always retained client-side after OS revoke.
    await apiClient
      .delete("/api/core/push/subscribe", {
        platform: platform === "ios" || platform === "android" ? platform : undefined,
        nativeOnly: true,
      })
      .catch(() => {
        /* ignore */
      });
    return;
  }
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await reg?.pushManager?.getSubscription();
  const endpoint = sub?.endpoint;
  if (sub) await sub.unsubscribe();
  await apiClient.delete("/api/core/push/subscribe", endpoint ? { endpoint } : undefined).catch(() => {
    /* server cleanup even if browser had no sub */
  });
}

export async function syncPushSubscription(publicKey: string): Promise<boolean> {
  if (isNativeShell()) return subscribeNativePush();
  if (!isPushSupported()) return false;
  const reg = await serviceWorkerRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub || Notification.permission !== "granted") return false;
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  await apiClient.post("/api/core/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    timezone: deviceTimezone(),
  });
  return true;
}

/** Subscribe or re-sync when enabling a push type (permission already granted or prompt). */
export async function ensurePushSubscribedWhenEnabling(): Promise<boolean> {
  if (isNativeShell()) {
    return subscribeNativePush();
  }
  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) return false;
  if (Notification.permission === "granted") {
    return syncPushSubscription(config.publicKey);
  }
  if (Notification.permission === "default") {
    return subscribeBrowserPush(config.publicKey);
  }
  return false;
}
