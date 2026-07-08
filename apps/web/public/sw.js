/* Minimal service worker — installable PWA; network-first for app routes.
 * Bump CACHE when shell assets change so activate purges stale caches. */
const CACHE = "domi-ops-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/dashboard", "/icon.svg"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((r) => r ?? caches.match("/dashboard"))),
  );
});

function normalizePushPayload(raw) {
  const url = raw.data?.url ?? raw.url ?? "/dashboard?notices=1";
  const tag = raw.tag ?? "notice";
  return {
    title: raw.title ?? "Domi Ops",
    body: raw.body ?? "",
    tag,
    data: { ...(raw.data ?? {}), url },
  };
}

self.addEventListener("push", (event) => {
  let raw = { title: "Domi Ops", body: "", tag: "notice", data: { url: "/dashboard?notices=1" } };
  try {
    if (event.data) raw = { ...raw, ...event.data.json() };
  } catch {
    /* ignore */
  }
  const payload = normalizePushPayload(raw);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon: "/icons/icon-192.png",
        data: payload.data,
      });
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "domi-ops:notification" });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url ?? "/dashboard?notices=1";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          return client.focus().then(() => {
            if ("navigate" in client) return client.navigate(target);
          });
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    }),
  );
});
