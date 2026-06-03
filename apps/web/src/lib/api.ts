import { cookies } from "next/headers";

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

async function serverCookieHeader(): Promise<string | undefined> {
  const store = await cookies();
  const session = store.get("whome_session");
  if (!session) return undefined;
  return `${session.name}=${session.value}`;
}

export class ApiError extends Error {
  status: number;
  body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (typeof window === "undefined") {
    const cookie = await serverCookieHeader();
    if (cookie) headers.set("Cookie", cookie);
  }

  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`API ${res.status}`, res.status, body);
  }
  return res.json() as Promise<T>;
}

