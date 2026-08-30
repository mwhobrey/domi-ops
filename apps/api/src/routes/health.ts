import {
  inferDevWebProfile,
  loadEnv,
  oauthRedirectUris,
  validateDevPublicAppUrl,
} from "@domi-ops/config";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@domi-ops/db";

export function healthRoutes(db: Database) {
  const app = new Hono();

  // Mounted at /api (see index.ts) so it rides the existing /api/:path* rewrite in
  // apps/web/next.config.ts instead of needing its own special-cased proxy rule. Named
  // "healthz" (k8s-style liveness convention), not "health" — "/api/health" is already the
  // Health *module*'s own API surface (household-health.ts), and a bare "/health" collides
  // with the app's own /health page (WHO — found + fixed 2026-08-30: hosted-prod's Caddyfile
  // and this route both claimed the literal path "/health", so Caddy's proxy rule silently
  // shadowed the real page for every household, and the deploy script's own smoke test hit
  // this same endpoint and reported "healthy" while the page underneath was unreachable).
  app.get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      const env = loadEnv();
      const body: Record<string, unknown> = { status: "ok" };
      if (env.NODE_ENV === "development") {
        body.dev = {
          publicAppUrl: env.PUBLIC_APP_URL,
          profile: env.DOMI_OPS_DEV_PROFILE ?? inferDevWebProfile(env.PUBLIC_APP_URL),
          oauthRedirects: oauthRedirectUris(env.PUBLIC_APP_URL),
          warnings: validateDevPublicAppUrl({
            nodeEnv: env.NODE_ENV,
            publicAppUrl: env.PUBLIC_APP_URL,
            devProfile: env.DOMI_OPS_DEV_PROFILE,
            googleOAuthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
          }),
        };
      }
      return c.json(body);
    } catch {
      return c.json({ status: "degraded", db: false }, 503);
    }
  });

  return app;
}
