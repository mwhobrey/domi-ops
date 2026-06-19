import { useEffect } from "react";

/** Fired when push arrives or other tabs should refresh notification UIs. */
export const WHOME_NOTIFICATION_REFRESH = "whome:notification-refresh";

export function dispatchNotificationRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WHOME_NOTIFICATION_REFRESH));
}

/** Poll + focus/visibility + service-worker push while the tab is open. */
export function useLiveRefresh(
  refresh: () => void | Promise<void>,
  options?: { intervalMs?: number },
): void {
  const intervalMs = options?.intervalMs ?? 15_000;

  useEffect(() => {
    const run = () => void refresh();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "whome:notification") void refresh();
    };

    window.addEventListener(WHOME_NOTIFICATION_REFRESH, run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);

    return () => {
      window.removeEventListener(WHOME_NOTIFICATION_REFRESH, run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
      window.clearInterval(id);
    };
  }, [refresh, intervalMs]);
}
