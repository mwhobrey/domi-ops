/** Show a system notification via the active service worker (same path as Web Push). */
export async function showBrowserNotification(
  title: string,
  body: string,
  url: string,
  tag?: string,
): Promise<void> {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;
  await reg.showNotification(title, {
    body,
    tag: tag ?? "whome-alert",
    icon: "/icons/icon-192.png",
    data: { url },
  });
}

/** Notice pushes also write inbox rows tagged `notice-{id}` — hide those in Alerts. */
export function isNoticeMirrorAlert(tag: string | null | undefined): boolean {
  return Boolean(tag?.startsWith("notice-"));
}
