/** Browser-facing web ports for local dev (see docs/GOOGLE_OAUTH_SETUP.md). */
export const DEV_WEB_PORT_NATIVE = 3000;
export const DEV_WEB_PORT_DOCKER = 3001;

export type DevWebProfile = "native" | "docker";

export function publicAppPort(publicAppUrl: string): number | null {
  try {
    const u = new URL(publicAppUrl);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

export function inferDevWebProfile(publicAppUrl: string): DevWebProfile | null {
  const port = publicAppPort(publicAppUrl);
  if (port === DEV_WEB_PORT_NATIVE) return "native";
  if (port === DEV_WEB_PORT_DOCKER) return "docker";
  return null;
}

export function oauthRedirectUris(publicAppUrl: string): {
  login: string;
  calendar: string;
} {
  const base = publicAppUrl.replace(/\/$/, "");
  return {
    login: `${base}/auth/callback/google`,
    calendar: `${base}/auth/google/calendar/callback`,
  };
}

/** Dev-only browser origins (localhost vs 127.0.0.1) for Better Auth trustedOrigins. */
export function devLoopbackOrigins(publicAppUrl: string): string[] {
  try {
    const u = new URL(publicAppUrl);
    const portSuffix = u.port ? `:${u.port}` : "";
    return [
      ...new Set([
        u.origin,
        `${u.protocol}//localhost${portSuffix}`,
        `${u.protocol}//127.0.0.1${portSuffix}`,
        `${u.protocol}//[::1]${portSuffix}`,
      ]),
    ];
  } catch {
    return [publicAppUrl.replace(/\/$/, "")];
  }
}

/**
 * Development-only checks for PUBLIC_APP_URL / OAuth alignment.
 * Returns human-readable warnings (empty when OK).
 */
export function validateDevPublicAppUrl(opts: {
  nodeEnv: string;
  publicAppUrl: string;
  devProfile?: string;
  googleOAuthRedirectUri?: string;
}): string[] {
  if (opts.nodeEnv !== "development") return [];

  const warnings: string[] = [];
  const port = publicAppPort(opts.publicAppUrl);
  const explicitProfile =
    opts.devProfile === "native" || opts.devProfile === "docker" ? opts.devProfile : null;
  const inferred = inferDevWebProfile(opts.publicAppUrl);

  if (explicitProfile === "native" && port !== DEV_WEB_PORT_NATIVE) {
    warnings.push(
      `DOMI_OPS_DEV_PROFILE=native expects PUBLIC_APP_URL on :${DEV_WEB_PORT_NATIVE} (got port ${port ?? "unknown"}). OAuth redirects will not match http://localhost:${DEV_WEB_PORT_NATIVE}.`,
    );
  }
  if (explicitProfile === "docker" && port !== DEV_WEB_PORT_DOCKER) {
    warnings.push(
      `DOMI_OPS_DEV_PROFILE=docker expects PUBLIC_APP_URL on :${DEV_WEB_PORT_DOCKER} (got port ${port ?? "unknown"}). Use http://localhost:${DEV_WEB_PORT_DOCKER} when using docker compose web.`,
    );
  }
  if (!explicitProfile && inferred === null && port != null && port !== 80 && port !== 443) {
    warnings.push(
      `PUBLIC_APP_URL uses port ${port}. Local dev expects :${DEV_WEB_PORT_NATIVE} (npm run dev) or :${DEV_WEB_PORT_DOCKER} (docker compose web). Set DOMI_OPS_DEV_PROFILE=native|docker to silence after fixing .env.`,
    );
  }

  if (opts.googleOAuthRedirectUri) {
    try {
      const override = new URL(opts.googleOAuthRedirectUri);
      const app = new URL(opts.publicAppUrl);
      if (override.origin !== app.origin) {
        warnings.push(
          `GOOGLE_OAUTH_REDIRECT_URI origin (${override.origin}) differs from PUBLIC_APP_URL (${app.origin}). Prefer unset GOOGLE_OAUTH_REDIRECT_URI unless you know you need a split host.`,
        );
      }
    } catch {
      warnings.push("GOOGLE_OAUTH_REDIRECT_URI is not a valid URL.");
    }
  }

  return warnings;
}
