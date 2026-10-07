import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { baAccounts, closeDb, createDb, householdMembers, households, users, withSystemContext, withUserLookupContext } from "@domi-ops/db";
import type { Database } from "@domi-ops/db";
import { resolveAuthContext } from "./bootstrap.js";
import { createBetterAuth } from "./better-auth.js";

/**
 * Google sign-in through Better Auth's real handler (WHO-449): the sign-in request, then the callback Google would send the
 * browser back to, with only Google's token endpoint stubbed. Covers a new person, someone who already has a Google account
 * row (including rows written while Better Auth 1.7.0 to 1.7.2 wanted an `issuer`), and someone who has only a password
 * account for the same email. A Better Auth upgrade that changes how any of these resolve fails here, not in production.
 */

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const BASE_URL = "http://localhost:3000";
const env = {
  NODE_ENV: "test",
  PUBLIC_APP_URL: BASE_URL,
  SESSION_SECRET: "x".repeat(32),
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
} as Env;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.sig`;

/** Cookies a response sets, as a Cookie header value. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

maybeDescribe("Google sign-in (integration)", () => {
  let db: Database;
  const createdUserIds: string[] = [];
  const createdHouseholdIds: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    db = createDb(TEST_URL!);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  afterAll(async () => {
    await withSystemContext(db, async (tx) => {
      for (const id of createdHouseholdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of createdUserIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(db);
  });

  /** Runs the whole round trip for a Google profile and returns the callback's answer. */
  async function signInWithGoogle(
    profile: { sub: string; email: string; emailVerified?: boolean; name?: string },
    options: { tokenEndpointStatus?: number } = {},
  ) {
    const auth = createBetterAuth(db, env);

    const start = await auth.handler(
      new Request(`${BASE_URL}/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        // The same options the login page sends.
        body: JSON.stringify({ provider: "google", callbackURL: "/dashboard", errorCallbackURL: "/login" }),
      }),
    );
    expect(start.status, "sign-in/social should answer with the Google redirect").toBe(200);
    const { url } = (await start.json()) as { url: string };
    const google = new URL(url);
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const state = google.searchParams.get("state");
    expect(state).toBeTruthy();

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("https://oauth2.googleapis.com/token")) {
        if (options.tokenEndpointStatus && options.tokenEndpointStatus >= 400) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), { status: options.tokenEndpointStatus, headers: { "content-type": "application/json" } });
        }
        return new Response(
          JSON.stringify({
            access_token: "ya29.test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
            id_token: idToken({
              iss: "https://accounts.google.com",
              aud: env.GOOGLE_OAUTH_CLIENT_ID,
              sub: profile.sub,
              email: profile.email,
              email_verified: profile.emailVerified ?? true,
              name: profile.name ?? "Google Person",
              picture: "https://example.test/p.png",
            }),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    }) as typeof fetch;

    return auth.handler(
      new Request(`${BASE_URL}/auth/callback/google?code=test-code&state=${state}`, {
        method: "GET",
        headers: { cookie: cookieHeader(start), origin: BASE_URL },
      }),
    );
  }

  async function seedUser(email: string, accounts: Array<Record<string, unknown>> = []) {
    return withSystemContext(db, async (tx) => {
      const [u] = await tx.insert(users).values({ email, displayName: "Seeded", emailVerified: true }).returning({ id: users.id });
      createdUserIds.push(u.id);
      for (const a of accounts) await tx.insert(baAccounts).values({ userId: u.id, ...a } as typeof baAccounts.$inferInsert);
      return u.id;
    });
  }

  const accountsOf = (userId: string) =>
    withSystemContext(db, (tx) => tx.select().from(baAccounts).where(eq(baAccounts.userId, userId)));

  function expectSignedIn(res: Response) {
    const where = res.headers.get("location") ?? "";
    expect(res.status, `callback answered ${res.status} to ${where}`).toBe(302);
    expect(where, "callback should not redirect to an error").not.toMatch(/error=/);
    expect(res.headers.getSetCookie().join(";"), "a session cookie should be set").toMatch(/session_token/);
  }

  /** Asks Better Auth who the cookies from the callback belong to, the way the browser's next request would. */
  async function expectSessionUser(res: Response, userId: string) {
    const auth = createBetterAuth(db, env);
    const who = await auth.handler(
      new Request(`${BASE_URL}/auth/get-session`, { headers: { cookie: cookieHeader(res), origin: BASE_URL } }),
    );
    const body = (await who.json()) as { user?: { id: string } } | null;
    expect(body?.user?.id, "the callback session should identify the seeded person").toBe(userId);
  }

  it("signs in a person who already has a Google account row", async () => {
    const sub = `g-${randomUUID()}`;
    const email = `google-${randomUUID()}@example.test`;
    const userId = await seedUser(email, [{ providerId: "google", accountId: sub }]);
    const res = await signInWithGoogle({ sub, email });
    expectSignedIn(res);
    await expectSessionUser(res, userId);
    expect((await accountsOf(userId)).filter((a) => a.providerId === "google")).toHaveLength(1);
  });

  it("signs in a person whose Google row still carries the 1.7.0-1.7.2 issuer", async () => {
    const sub = `g-${randomUUID()}`;
    const email = `google-${randomUUID()}@example.test`;
    const userId = await seedUser(email, [{ providerId: "google", accountId: sub, issuer: "local:oauth:google" }]);
    const res = await signInWithGoogle({ sub, email });
    expectSignedIn(res);
    await expectSessionUser(res, userId);
    expect((await accountsOf(userId)).filter((a) => a.providerId === "google")).toHaveLength(1);
  });

  it("sends a failed callback to the login page with exactly one error code", async () => {
    const sub = `g-${randomUUID()}`;
    const email = `google-${randomUUID()}@example.test`;
    await seedUser(email, [{ providerId: "google", accountId: sub }]);
    const res = await signInWithGoogle({ sub, email }, { tokenEndpointStatus: 400 });
    const where = new URL(res.headers.get("location") ?? "", BASE_URL);
    expect(res.status).toBe(302);
    expect(where.pathname).toBe("/login");
    expect(where.searchParams.getAll("error"), "one error parameter, not a preset plus Better Auth's").toHaveLength(1);
    expect(where.searchParams.get("error")).toBeTruthy();
    expect(res.headers.getSetCookie().join(";")).not.toMatch(/session_token=[^;]/);
  });

  it("links Google to a person who has only a password account for the same email", async () => {
    const sub = `g-${randomUUID()}`;
    const email = `google-${randomUUID()}@example.test`;
    const userId = await seedUser(email, [{ providerId: "credential", accountId: "will-be-user-id", password: "x" }]);
    const res = await signInWithGoogle({ sub, email });
    expectSignedIn(res);
    await expectSessionUser(res, userId);
    expect((await accountsOf(userId)).map((a) => a.providerId).sort()).toEqual(["credential", "google"]);
  });

  it("creates a new person on first Google sign-in", async () => {
    const sub = `g-${randomUUID()}`;
    const email = `google-${randomUUID()}@example.test`;
    const res = await signInWithGoogle({ sub, email });
    const [created] = await withSystemContext(db, (tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, email)));
    if (created) createdUserIds.push(created.id);
    expectSignedIn(res);
    expect(created, "a user should have been created").toBeTruthy();
  });

  it("leaves a session that resolves to the person's household member, the way the web app checks it", async () => {
    const sub = `g-${randomUUID()}`;
    const email = `google-${randomUUID()}@example.test`;
    const userId = await seedUser(email, [{ providerId: "google", accountId: sub }]);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx.insert(households).values({ name: "Google test home", timezone: "UTC" }).returning({ id: households.id });
      createdHouseholdIds.push(hh.id);
      await tx.insert(householdMembers).values({ householdId: hh.id, userId, role: "owner", name: "Google Person" });
    });

    const res = await signInWithGoogle({ sub, email });
    expectSignedIn(res);

    await expectSessionUser(res, userId);
    // The API answers /auth/session inside the person's own lookup context; do the same.
    const ctx = await withUserLookupContext(db, userId, (tx) => resolveAuthContext(tx as unknown as Database, userId));
    expect(ctx, "and they should resolve to a household member").not.toBeNull();
  });
});
