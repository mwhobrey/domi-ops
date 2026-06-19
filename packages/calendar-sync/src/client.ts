import { decryptSensitive, encryptSensitive, SensitiveDecryptError } from "@whome/crypto";
import type { Env } from "@whome/config";
import { refreshGoogleAccessToken, GoogleOAuthTokenError } from "@whome/auth";
import type { Database } from "@whome/db";
import { calendarConnections } from "@whome/db";
import { eq } from "drizzle-orm";

export class CalendarCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarCredentialsError";
  }
}

export interface CalendarConnectionRow {
  id: string;
  refreshTokenEnc: string;
  accessTokenEnc: string | null;
  tokenExpiry: Date | null;
}

export function getTokens(
  conn: CalendarConnectionRow,
  encryptionKey: string,
): { refreshToken: string; accessToken: string | null } {
  try {
    return {
      refreshToken: decryptSensitive(conn.refreshTokenEnc, encryptionKey),
      accessToken: conn.accessTokenEnc
        ? decryptSensitive(conn.accessTokenEnc, encryptionKey)
        : null,
    };
  } catch (e) {
    if (e instanceof SensitiveDecryptError) {
      throw new CalendarCredentialsError(e.message);
    }
    throw e;
  }
}

export async function ensureAccessToken(
  db: Database,
  env: Env,
  conn: CalendarConnectionRow & { id: string },
): Promise<string> {
  const key = env.ENCRYPTION_KEY;
  if (!key) throw new CalendarCredentialsError("ENCRYPTION_KEY not configured");
  const tokens = getTokens(conn, key);
  const expiry = conn.tokenExpiry;
  if (
    tokens.accessToken &&
    expiry &&
    expiry.getTime() > Date.now() + 60_000
  ) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new CalendarCredentialsError("Missing refresh token — reconnect Google Calendar");
  }
  let refreshed;
  try {
    refreshed = await refreshGoogleAccessToken(env, tokens.refreshToken);
  } catch (e) {
    if (e instanceof GoogleOAuthTokenError && e.oauthError === "invalid_grant") {
      await db
        .update(calendarConnections)
        .set({
          syncRunStatus: "error",
          syncRunError:
            "Google Calendar access expired or was revoked — reconnect in Calendar settings",
        })
        .where(eq(calendarConnections.id, conn.id));
      throw new CalendarCredentialsError(
        "Google Calendar access expired or was revoked — reconnect Google",
      );
    }
    throw e;
  }
  const accessEnc = encryptSensitive(refreshed.access_token, key);
  const tokenExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000);
  await db
    .update(calendarConnections)
    .set({ accessTokenEnc: accessEnc, tokenExpiry })
    .where(eq(calendarConnections.id, conn.id));
  return refreshed.access_token;
}

export async function googleCalendarFetch(
  accessToken: string,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function listGoogleCalendars(accessToken: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string> = {};
    if (pageToken) params.pageToken = pageToken;
    const resp = (await googleCalendarFetch(accessToken, "/users/me/calendarList", params)) as {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
    };
    items.push(...(resp.items ?? []));
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return items;
}
