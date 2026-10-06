import { useEffect, useRef } from "react";
import { createRefreshGate } from "./refresh-gate";

/** Fired when push arrives or other tabs should refresh notification UIs. */
export const DOMI_OPS_NOTIFICATION_REFRESH = "domi-ops:notification-refresh";

export function dispatchNotificationRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOMI_OPS_NOTIFICATION_REFRESH));
}

/** Switching back to a tab fires focus and visibilitychange together; one refresh covers both. */
const PASSIVE_MIN_GAP_MS = 2_000;

/**
 * Poll + focus/visibility + service-worker push while the tab is open. Refreshes never overlap and
 * the passive triggers (timer, focus, visibility) are coalesced; a push or a dispatched event always
 * gets a refresh (WHO-438, see refresh-gate.ts).
 */
export function useLiveRefresh(
  refresh: () => void | Promise<void>,
  options?: { intervalMs?: number },
): void {
  const intervalMs = options?.intervalMs ?? 15_000;
  const latest = useRef(refresh);
  latest.current = refresh;
  const gateRef = useRef<ReturnType<typeof createRefreshGate> | null>(null);
  gateRef.current ??= createRefreshGate(() => latest.current(), { minGapMs: PASSIVE_MIN_GAP_MS });

  useEffect(() => {
    const gate = gateRef.current!;
    const explicit = () => gate.explicit();
    const passive = () => gate.passive();

    const onVisibility = () => {
      if (document.visibilityState === "visible") gate.passive();
    };

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "domi-ops:notification") gate.explicit();
    };

    window.addEventListener(DOMI_OPS_NOTIFICATION_REFRESH, explicit);
    window.addEventListener("focus", passive);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    // Mounting, or the refresh function changing (a panel opened), wants fresh data now.
    gate.explicit();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") gate.passive();
    }, intervalMs);

    return () => {
      window.removeEventListener(DOMI_OPS_NOTIFICATION_REFRESH, explicit);
      window.removeEventListener("focus", passive);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
      window.clearInterval(id);
    };
  }, [refresh, intervalMs]);
}
