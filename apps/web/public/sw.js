/* Minimal service worker — installable PWA; network-first for app routes.
 * Bump CACHE when shell assets change so activate purges stale caches. */
const CACHE = "domi-ops-shell-v2";

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
    actions: Array.isArray(raw.actions) ? raw.actions : undefined,
    data: { ...(raw.data ?? {}), url },
  };
}

function openAppPath(path) {
  const target = new URL(path, self.location.origin).href;
  return clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ("focus" in client) {
        return client.focus().then(() => {
          if ("navigate" in client) return client.navigate(target);
        });
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  });
}

function medActionFallbackUrl(data, action) {
  const params = new URLSearchParams();
  if (data.medicationId) params.set("medication", data.medicationId);
  params.set("action", action === "skip" ? "skip" : "taken");
  if (data.scheduledAt) params.set("scheduledAt", data.scheduledAt);
  if (data.token) params.set("token", data.token);
  return `/health?${params.toString()}`;
}

async function postMedPushAction(token, action) {
  const status = action === "skip" ? "skipped" : "taken";
  const res = await fetch("/api/health/medications/push-action", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action: status }),
  });
  return res.ok;
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
        ...(payload.actions?.length ? { actions: payload.actions } : {}),
      });
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: "domi-ops:notification" });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const action = event.action;

  if ((action === "taken" || action === "skip") && data.token) {
    event.waitUntil(
      (async () => {
        try {
          const ok = await postMedPushAction(data.token, action);
          if (ok) {
            const clientList = await self.clients.matchAll({
              type: "window",
              includeUncontrolled: true,
            });
            for (const client of clientList) {
              client.postMessage({
                type: "domi-ops:med-logged",
                medicationId: data.medicationId,
                action,
              });
            }
            return;
          }
        } catch {
          /* fall through to deep link */
        }
        return openAppPath(medActionFallbackUrl(data, action));
      })(),
    );
    return;
  }

  const path = data.url ?? "/dashboard?notices=1";
  event.waitUntil(openAppPath(path));
});
