/**
 * Server-side fetch uses API_URL (docker: http://api:4000).
 * Browser-facing links use same-origin paths proxied by next.config rewrites.
 */
function serverApiBase(): string {
  return process.env.API_URL ?? "http://localhost:4000";
}

/** Base URL for fetch() — empty in browser (rewrites), internal URL on server */
export function apiBase(): string {
  if (typeof window !== "undefined") return "";
  return serverApiBase();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function googleLoginUrl(): string {
  return "/auth/google/login";
}

export function googleCalendarConnectUrl(): string {
  return "/auth/google/calendar/start";
}
