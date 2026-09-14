"use client";

import { useEffect } from "react";
import { isNativeShell } from "../lib/native-shell";
import { ensurePushSubscribedWhenEnabling } from "../lib/web-push";
import { syncRevenueCatUser } from "../lib/revenuecat-client";
import { authClient } from "../lib/auth-client";

/**
 * Boot hooks for the Capacitor remote WebView (push token + RevenueCat identity).
 * No-op in browser / PWA.
 */
export function NativeShellBoot() {
  useEffect(() => {
    if (!isNativeShell()) return;

    let cancelled = false;

    void (async () => {
      try {
        await ensurePushSubscribedWhenEnabling();
      } catch (err) {
        console.warn("[domi-ops native] push subscribe failed", err);
      }

      if (cancelled) return;
      try {
        const session = await authClient.getSession();
        const uid = session.data?.user?.id;
        if (uid) await syncRevenueCatUser(uid);
      } catch (err) {
        console.warn("[domi-ops native] revenuecat sync failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
