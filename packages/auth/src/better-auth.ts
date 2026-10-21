import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username, jwt } from "better-auth/plugins";
import type { Env } from "@domi-ops/config";
import { devLoopbackOrigins } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { baAccounts, baSessions, baVerifications, users, withUserLookupContext, mcpProviderSchema } from "@domi-ops/db";
import { createMcpAuthorization, type McpAuthorization } from "./mcp.js";
import { mcpAuthAdapter } from "./mcp-adapter.js";
import { ensureHouseholdMembership } from "./household-membership.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./mail.js";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "./username.js";

/** Narrow surface we use from Better Auth — avoids leaking plugin-specific inferred types into .d.ts. */
export interface WhomeBetterAuth {
  api: {
    getSession: (input: {
      headers: Headers;
    }) => Promise<{ user?: { id: string; email?: string | null } } | null>;
  };
  handler: (request: Request) => Response | Promise<Response>;
}

export function createBetterAuth(db: Database, env: Env, options: { deferHouseholdMembership?: (headers: Headers) => Promise<boolean>; cookiePrefix?: string } = {}): WhomeBetterAuth & { mcp: McpAuthorization } {
  const secret =
    env.SESSION_SECRET ?? "dev-only-insecure-secret-replace-before-production!!";

  const socialProviders: {
    google?: { clientId: string; clientSecret: string };
    apple?: { clientId: string; clientSecret: string; appBundleIdentifier?: string };
  } = {};

  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    };
  }
  // Sign in with Apple — required on iOS store builds once Google is offered (Guideline 4.8 / WHO-288).
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    socialProviders.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
      ...(env.APPLE_APP_BUNDLE_IDENTIFIER
        ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER }
        : {}),
    };
  }

  const mcp = createMcpAuthorization(db, env, secret);
  // Keys match Better Auth model names; SQL names are owned by the Drizzle tables.
  const schema = { users, ba_sessions: baSessions, ba_accounts: baAccounts, ba_verifications: baVerifications, ...mcpProviderSchema };
  const auth = betterAuth({
    secret,
    baseURL: env.PUBLIC_APP_URL,
    basePath: "/auth",
    trustedOrigins:
      env.NODE_ENV === "development"
        ? devLoopbackOrigins(env.PUBLIC_APP_URL)
        : [
            env.PUBLIC_APP_URL,
            ...(env.EXTRA_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
          ],
    disabledPaths: ["/token"],
    database: env.MCP_ENABLED
      ? mcpAuthAdapter(db, schema, new Set(Object.keys(mcpProviderSchema)))
      : drizzleAdapter(db, { provider: "pg", schema }),
    user: {
      modelName: "users",
      // Drizzle property names — SQL columns stay snake_case in @domi-ops/db schema.
      fields: {
        name: "displayName",
        image: "imageUrl",
      },
      additionalFields: {
        temperatureUnit: {
          type: "string",
          required: false,
          defaultValue: "fahrenheit",
          input: false,
        },
        pushNoticesEnabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        pushCalendarRemindersEnabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        pushChoresRemindersEnabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        pushExpenseBudgetAlertsEnabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        pushSchoolRemindersEnabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        pushShoppingRemindersEnabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
      },
    },
    session: {
      modelName: "ba_sessions",
    },
    account: {
      modelName: "ba_accounts",
      // Better Auth decrypts legacy plaintext values on read; new token writes
      // are encrypted with SESSION_SECRET. Existing rows need operator rotation.
      encryptOAuthTokens: true,
    },
    verification: {
      modelName: "ba_verifications",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: env.EMAIL_VERIFICATION_REQUIRED ?? false,
      // WHO-254 — no self-service recovery existed at all before this; a locked-out user's only
      // option was a manual DB update by whoever has server access.
      sendResetPassword: async ({ user, url }) => {
        if (!user.email) return;
        await sendPasswordResetEmail(env, { to: user.email, url, name: user.name });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!user.email) return;
        await sendVerificationEmail(env, {
          to: user.email,
          url,
          name: user.name,
        });
      },
    },
    // A failed sign-in lands on the login page with the reason in the URL, instead of Better Auth's bare error page that the
    // site turns into a silent bounce (WHO-449). The login page shows what happened.
    onAPIError: { errorURL: "/login" },
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    plugins: [
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameValidator: (value) => USERNAME_PATTERN.test(value),
      }),
      ...(env.MCP_ENABLED ? [jwt(), mcp.provider] : []),
    ],
    advanced: {
      ...(options.cookiePrefix ? { cookiePrefix: options.cookiePrefix } : {}),
      database: {
        generateId: () => randomUUID(),
      },
      // Caddy (the only reverse proxy in front of this app - see deploy/Caddyfile*.example) sets
      // X-Forwarded-For to the real observed connecting IP on every reverse_proxy request; it
      // does not blindly forward a client-supplied value. Without this, better-auth can't
      // determine a client IP at all and falls back to a single rate-limit bucket shared across
      // every client (WHO-251) - one aggressive client could exhaust it and lock out real users.
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },
    databaseHooks: {
      account: {
        // Provider ID tokens are needed for callback verification, not app sessions.
        // Better Auth encryptOAuthTokens covers access/refresh tokens only.
        create: { before: async (account) => ({ data: { ...account, idToken: null } }) },
        update: { before: async (account) => ({ data: { ...account, idToken: null } }) },
      },
      session: {
        create: {
          after: async (session, context) => {
            try {
              // Invitation acceptance owns membership and role assignment, even on
              // self-host instances that normally auto-join a newly signed-in user.
              const headers = context?.headers ?? context?.request?.headers;
              if (headers && await options.deferHouseholdMembership?.(headers)) return;
              // Runs before any household context exists (we're figuring out household
              // membership right here), so it needs the member_auth_lookup RLS policy — the
              // same "resolve by user_id first" scope auth middleware uses elsewhere. Without
              // this, every plain lookup here returns zero rows under the restricted hosted-prod
              // role (NOBYPASSRLS), and every login gets treated as "user has no household."
              await withUserLookupContext(db, session.userId, (tx) =>
                ensureHouseholdMembership(tx, env, session.userId),
              );
            } catch (err) {
              console.error("[domi-ops auth] ensureHouseholdMembership failed:", err);
              throw err;
            }
          },
        },
      },
    },
  });
  return {
    api: auth.api,
    handler: (request) => {
      const path = new URL(request.url).pathname;
      // Only the one-use application consent endpoint may enter these continuations.
      if (path === "/auth/oauth2/consent" || path === "/auth/oauth2/continue") return Response.json({ error: "consent_required" }, { status: 403 });
      if (!env.MCP_ENABLED && (path.startsWith("/auth/oauth2/") || path.startsWith("/auth/admin/oauth2/") || path === "/auth/jwks" || path.includes("/.well-known/"))) return Response.json({ error: "not_found" }, { status: 404 });
      return auth.handler(request);
    },
    mcp: mcp.attach(auth),
  };
}
