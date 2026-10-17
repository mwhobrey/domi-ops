import { createHmac, timingSafeEqual } from "node:crypto";

export type BrowserUploadGrant = {
  uploadId: string;
  key: string;
  householdId: string;
  memberId: string;
  contentType: string;
  maxBytes: number | null;
  exp: number;
};

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signBrowserUploadToken(
  secret: string,
  grant: Omit<BrowserUploadGrant, "exp">,
  expiresInSec: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const body = Buffer.from(JSON.stringify({ ...grant, exp }), "utf8").toString("base64url");
  return `${body}.${signBody(secret, body)}`;
}

export function verifyBrowserUploadToken(secret: string, token: string): BrowserUploadGrant {
  const dot = token.indexOf(".");
  if (dot <= 0) throw new Error("invalid_token");
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signBody(secret, body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("invalid_token");
  }
  const grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BrowserUploadGrant;
  if (grant.exp < Math.floor(Date.now() / 1000)) throw new Error("token_expired");
  return grant;
}

/** Same-origin PUT URL — API streams to MinIO (no public /s3 Caddy route required). */
export function browserUploadPutUrl(
  env: { PUBLIC_APP_URL: string; SESSION_SECRET?: string },
  grant: Omit<BrowserUploadGrant, "exp">,
  expiresInSec = 15 * 60,
): string {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error("session_secret_required");
  const token = signBrowserUploadToken(secret, grant, expiresInSec);
  const base = env.PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/api/core/upload/${grant.uploadId}?token=${encodeURIComponent(token)}`;
}
