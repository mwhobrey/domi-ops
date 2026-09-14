/**
 * First-run server picker for the Capacitor shell (WHO-287).
 * Validates /api/healthz, persists the origin, then navigates the WebView there.
 *
 * Uses the Capacitor bridge globals (injected by the native shell) — no bundler
 * required for this local www/ entry. Browser preview falls back to localStorage.
 */
const PREF_KEY = "domi.serverUrl";
const DEFAULT_URL = "https://app.domi-ops.com";

const form = document.getElementById("connect-form");
const input = document.getElementById("server-url");
const statusEl = document.getElementById("status");
const button = document.getElementById("connect-btn");

function capacitor() {
  return globalThis.Capacitor ?? null;
}

function preferences() {
  return capacitor()?.Plugins?.Preferences ?? null;
}

async function prefGet(key) {
  const prefs = preferences();
  if (prefs) {
    const result = await prefs.get({ key });
    return result?.value ?? null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function prefSet(key, value) {
  const prefs = preferences();
  if (prefs) {
    await prefs.set({ key, value });
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "ok");
  if (kind) statusEl.classList.add(kind);
}

function normalizeServerUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new Error("Enter a server URL.");
  let url;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must start with https:// (or http:// for local LAN).");
  }
  return `${url.protocol}//${url.host}`;
}

async function probeHealthz(origin) {
  const url = `${origin}/api/healthz`;
  // Prefer CapacitorHttp — WebView fetch is cross-origin from https://localhost and hits CORS.
  const Http = capacitor()?.Plugins?.CapacitorHttp;
  if (Http?.request || Http?.get) {
    const res = Http.get
      ? await Http.get({
          url,
          headers: { Accept: "application/json" },
          connectTimeout: 8000,
          readTimeout: 8000,
        })
      : await Http.request({
          url,
          method: "GET",
          headers: { Accept: "application/json" },
          connectTimeout: 8000,
          readTimeout: 8000,
        });
    const status = res?.status ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(`Server responded ${status} from /api/healthz.`);
    }
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Server responded ${res.status} from /api/healthz.`);
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Timed out reaching /api/healthz.");
    }
    throw new Error(err?.message || "Could not reach /api/healthz.");
  } finally {
    clearTimeout(timer);
  }
}

async function goToServer(origin) {
  await prefSet(PREF_KEY, origin);
  // allowNavigation: ["*"] keeps this inside the Capacitor WebView with the bridge.
  window.location.href = `${origin}/login`;
}

async function boot() {
  const saved = await prefGet(PREF_KEY);
  if (saved) {
    input.value = saved;
    setStatus("Reconnecting…", "ok");
    try {
      await probeHealthz(saved);
      await goToServer(saved);
      return;
    } catch (err) {
      setStatus(`${err.message} — update the URL and try again.`, "error");
    }
  } else {
    input.value = DEFAULT_URL;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  setStatus("Checking server…");
  try {
    const origin = normalizeServerUrl(input.value);
    input.value = origin;
    await probeHealthz(origin);
    setStatus("Connected. Opening app…", "ok");
    await goToServer(origin);
  } catch (err) {
    setStatus(err.message || "Connection failed.", "error");
    button.disabled = false;
  }
});

void boot();
