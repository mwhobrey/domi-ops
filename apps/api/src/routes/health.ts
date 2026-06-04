import {
  inferDevWebProfile,
  loadEnv,
  oauthRedirectUris,
  validateDevPublicAppUrl,
} from "@whome/config";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@whome/db";

export function healthRoutes(db: Database) {
  const app = new Hono();

  app.get("/health", async (c) => {
    try {
      await db.execute(sql`select 1`);
      const env = loadEnv();
      const body: Record<string, unknown> = { status: "ok" };
      if (env.NODE_ENV === "development") {
        body.dev = {
          publicAppUrl: env.PUBLIC_APP_URL,
          profile: env.WHOME_DEV_PROFILE ?? inferDevWebProfile(env.PUBLIC_APP_URL),
          oauthRedirects: oauthRedirectUris(env.PUBLIC_APP_URL),
          warnings: validateDevPublicAppUrl({
            nodeEnv: env.NODE_ENV,
            publicAppUrl: env.PUBLIC_APP_URL,
            devProfile: env.WHOME_DEV_PROFILE,
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
