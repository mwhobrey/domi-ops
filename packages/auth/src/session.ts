import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { authSessions } from "@whome/db";
import { and, eq, gt } from "drizzle-orm";

export const SESSION_COOKIE = "whome_session";
const SESSION_DAYS = 30;

export interface SessionPayload {
  sessionId: string;
  userId: string;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeSessionCookie(sessionId: string, secret: string): string {
  const sig = sign(sessionId, secret);
  return `${sessionId}.${sig}`;
}

export function decodeSessionCookie(
  cookie: string | undefined,
  secret: string,
): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return null;
  const sessionId = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = sign(sessionId, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return sessionId;
}

export function sessionCookieOptions(env: Env): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export async function createSession(
  db: Database,
  userId: string,
  secret: string,
): Promise<{ cookie: string; expiresAt: Date }> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  const [row] = await db
    .insert(authSessions)
    .values({ userId, expiresAt })
    .returning();
  return {
    cookie: encodeSessionCookie(row.id, secret),
    expiresAt,
  };
}

export async function getSessionUserId(
  db: Database,
  cookie: string | undefined,
  secret: string,
): Promise<string | null> {
  const sessionId = decodeSessionCookie(cookie, secret);
  if (!sessionId) return null;
  const now = new Date();
  const [row] = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.id, sessionId), gt(authSessions.expiresAt, now)))
    .limit(1);
  return row?.userId ?? null;
}

export async function destroySession(
  db: Database,
  cookie: string | undefined,
  secret: string,
): Promise<void> {
  const sessionId = decodeSessionCookie(cookie, secret);
  if (!sessionId) return;
  await db.delete(authSessions).where(eq(authSessions.id, sessionId));
}

export function randomOAuthState(): string {
  return randomBytes(24).toString("base64url");
}
