import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import type { Env } from "@domi-ops/config";
import { devLoopbackOrigins } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { baAccounts, baSessions, baVerifications, users } from "@domi-ops/db";
import { ensureHouseholdMembership } from "./household-membership.js";
import { sendVerificationEmail } from "./mail.js";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "./username.js";

/** Narrow surface we use from Better Auth — avoids leaking plugin-specific inferred types into .d.ts. */
export interface WhomeBetterAuth {
  api: {
    getSession: (input: { headers: Headers }) => Promise<{ user?: { id: string } } | null>;
  };
  handler: (request: Request) => Response | Promise<Response>;
}

export function createBetterAuth(db: Database, env: Env): WhomeBetterAuth {
  const secret =
    env.SESSION_SECRET ?? "dev-only-insecure-secret-replace-before-production!!";

  const socialProviders =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          },
        }
      : undefined;

  return betterAuth({
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
    database: drizzleAdapter(db, {
      provider: "pg",
      // Keys must match modelName below (not Better Auth defaults like "user"/"session").
      schema: {
        users,
        ba_sessions: baSessions,
        ba_accounts: baAccounts,
        ba_verifications: baVerifications,
      },
    }),
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
    },
    verification: {
      modelName: "ba_verifications",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: env.EMAIL_VERIFICATION_REQUIRED ?? false,
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
    socialProviders,
    plugins: [
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameValidator: (value) => USERNAME_PATTERN.test(value),
      }),
    ],
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            try {
              await ensureHouseholdMembership(db, env, session.userId);
            } catch (err) {
              console.error("[domi-ops auth] ensureHouseholdMembership failed:", err);
              throw err;
            }
          },
        },
      },
    },
  });
}
