import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type { WhomeBetterAuth } from "@domi-ops/auth";
import type { AppVariables } from "../middleware/auth.js";

type NativeAuthBody = {
  provider: "google" | "apple";
  idToken: string;
  /** Optional access token from the native Google plugin. */
  accessToken?: string;
};

/**
 * Capacitor store shell auth (WHO-288).
 *
 * Google popup/redirect die inside WKWebView. The native plugin returns an idToken;
 * we hand it to Better Auth's social idToken path so the session cookie is set on the
 * chosen origin (same-origin with live apps/web).
 */
export function nativeAuthRoutes(db: Database, env: Env, betterAuth: WhomeBetterAuth) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post("/native-auth/social", async (c) => {
    const body = await c.req.json<NativeAuthBody>().catch(() => null);
    if (!body?.idToken || (body.provider !== "google" && body.provider !== "apple")) {
      return c.json({ error: "invalid_body" }, 400);
    }

    if (body.provider === "google" && !(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)) {
      return c.json({ error: "google_not_configured" }, 503);
    }
    if (body.provider === "apple" && !(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET)) {
      return c.json({ error: "apple_not_configured" }, 503);
    }

    try {
      // Better Auth social idToken sign-in — returns Set-Cookie for the session.
      // Typed loosely: plugin surface varies by better-auth version.
      const api = betterAuth.api as {
        signInSocial?: (input: {
          body: {
            provider: string;
            idToken: { token: string; accessToken?: string };
          };
          headers: Headers;
          asResponse?: boolean;
        }) => Promise<Response>;
      };

      if (!api.signInSocial) {
        return c.json(
          {
            error: "native_social_unsupported",
            message:
              "Better Auth build does not expose signInSocial with idToken yet. Upgrade @domi-ops/auth / better-auth.",
          },
          501,
        );
      }

      const response = await api.signInSocial({
        body: {
          provider: body.provider,
          idToken: {
            token: body.idToken,
            ...(body.accessToken ? { accessToken: body.accessToken } : {}),
          },
        },
        headers: c.req.raw.headers,
        asResponse: true,
      });

      return response;
    } catch (err) {
      console.error("[domi-ops native-auth] social sign-in failed:", err);
      return c.json({ error: "native_auth_failed" }, 401);
    }
  });

  // db reserved for future account-link lookups; keep signature aligned with other route factories.
  void db;

  return app;
}
