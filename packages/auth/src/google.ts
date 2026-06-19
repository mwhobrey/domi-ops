import { randomBytes } from "node:crypto";
import type { Env } from "@whome/config";

export function randomOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** OAuth callbacks must match Google Console — use the URL users see (PUBLIC_APP_URL), not internal API_URL. */
export function googleOAuthRedirectUri(env: Env, callbackPath: string): string {
  const base = env.PUBLIC_APP_URL.replace(/\/$/, "");
  const path = callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;
  return `${base}${path}`;
}

export const GOOGLE_LOGIN_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export const GOOGLE_CALENDAR_SCOPES = [
  ...GOOGLE_LOGIN_SCOPES,
  "https://www.googleapis.com/auth/calendar",
];

export function googleAuthUrl(
  env: Env,
  opts: {
    redirectUri: string;
    scopes: string[];
    state: string;
    accessType?: "offline";
    prompt?: string;
  },
): string {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    access_type: opts.accessType ?? "online",
  });
  if (opts.prompt) params.set("prompt", opts.prompt);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
  id_token?: string;
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  return res.json() as Promise<GoogleTokenResponse>;
}

export async function refreshGoogleAccessToken(
  env: Env,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    let oauthError: string | undefined;
    try {
      oauthError = (JSON.parse(text) as { error?: string }).error;
    } catch {
      /* non-JSON body */
    }
    throw new GoogleOAuthTokenError(`Google token refresh failed: ${text}`, oauthError);
  }
  return res.json() as Promise<GoogleTokenResponse>;
}

/** Google OAuth token endpoint failure with parsed `error` code when JSON. */
export class GoogleOAuthTokenError extends Error {
  readonly oauthError?: string;

  constructor(message: string, oauthError?: string) {
    super(message);
    this.name = "GoogleOAuthTokenError";
    this.oauthError = oauthError;
  }
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Google userinfo");
  return res.json() as Promise<GoogleUserInfo>;
}
