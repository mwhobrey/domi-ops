/* Minimal service worker — installable PWA; network-first for app routes.
 * Bump CACHE when shell assets change so activate purges stale caches. */
const CACHE = "domi-ops-shell-v4";

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
  if (data.medicationGroupId) params.set("medicationGroup", data.medicationGroupId);
  else if (data.medicationId) params.set("medication", data.medicationId);
  params.set("action", action === "skip" ? "skip" : "taken");
  if (data.scheduledAt) params.set("scheduledAt", data.scheduledAt);
  if (data.token) params.set("token", data.token);
  return `/health?${params.toString()}`;
}

async function postMedPushAction(data, action) {
  const status = action === "skip" ? "skipped" : "taken";
  // Group reminders carry medicationGroupId and were signed with the group token shape
  // (verifyHealthMedGroupPushActionToken) — posting those to the singular /medications/
  // push-action endpoint fails server-side verification (checkSubject requires medicationId),
  // so a group reminder's Taken/Skip tap must go to the group endpoint instead.
  const endpoint = data.medicationGroupId
    ? "/api/health/medication-groups/push-action"
    : "/api/health/medications/push-action";
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: data.token, action: status }),
  });
  return res.ok;
}

// Health check reminders (WHO-388): "Skip" is the only thing a button can do for a check, since
// logging one needs values. "Log now" is not handled here: it falls through to opening data.url.
async function postCheckSkip(data) {
  const res = await fetch("/api/health/checks/push-action", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: data.token, action: "skip", timeZone: data.timeZone }),
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
        // Android status-bar (collapsed) monochrome mark — without this it falls back to a
        // generic bell, indistinguishable from other apps'.
        badge: "/icons/badge-96.png",
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

  // Checked before the medication branch below: a check reminder also carries a token and "skip".
  if (action === "skip" && data.checkId && data.token) {
    event.waitUntil(
      (async () => {
        try {
          if (await postCheckSkip(data)) {
            const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            for (const client of clientList) {
              client.postMessage({ type: "domi-ops:check-logged", checkId: data.checkId, action });
            }
            return;
          }
        } catch {
          /* fall through to the deep link */
        }
        // Could not skip from here (offline, signed out, slot changed): open the slot instead.
        return openAppPath(data.url ?? "/health");
      })(),
    );
    return;
  }

  if ((action === "taken" || action === "skip") && data.token) {
    event.waitUntil(
      (async () => {
        try {
          const ok = await postMedPushAction(data, action);
          if (ok) {
            const clientList = await self.clients.matchAll({
              type: "window",
              includeUncontrolled: true,
            });
            for (const client of clientList) {
              client.postMessage({
                type: "domi-ops:med-logged",
                medicationId: data.medicationId,
                medicationGroupId: data.medicationGroupId,
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
