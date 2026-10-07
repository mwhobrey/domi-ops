import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { Env } from "@domi-ops/config";
import { baAccounts, closeDb, createDb, users, withSystemContext } from "@domi-ops/db";
import type { Database } from "@domi-ops/db";
import { createBetterAuth } from "./better-auth.js";

/**
 * Regression coverage for WHO-250 and the Better Auth 1.7.3 account-identity change: several
 * places insert the credential ba_accounts row by hand (self-host /setup, hosted checkout signup,
 * provisioned members, seed scripts). This signs in through Better Auth's real handler against a
 * row shaped exactly like those inserts (providerId + accountId === user.id + password, nothing
 * else), so a Better Auth upgrade that changes how credential accounts are matched fails here
 * instead of locking every manually-created account out in production.
 */

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const BASE_URL = "http://localhost:3000";

maybeDescribe("credential sign-in for manually inserted accounts (integration)", () => {
  let db: Database;
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      for (const id of createdUserIds) {
        await tx.delete(users).where(eq(users.id, id));
      }
    });
    await closeDb(db);
  });

  async function signIn(email: string, password: string) {
    const auth = createBetterAuth(db, {
      NODE_ENV: "test",
      PUBLIC_APP_URL: BASE_URL,
      SESSION_SECRET: "x".repeat(32),
    } as Env);
    return auth.handler(
      new Request(`${BASE_URL}/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email, password }),
      }),
    );
  }

  it("signs in with a credential account inserted without any issuer", async () => {
    db = createDb(TEST_URL!);
    const email = `signin-${randomUUID()}@example.test`;
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);

    await withSystemContext(db, async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, displayName: "Sign-in test", emailVerified: true })
        .returning({ id: users.id });
      createdUserIds.push(created.id);
      await tx.insert(baAccounts).values({
        userId: created.id,
        providerId: "credential",
        accountId: created.id,
        password: passwordHash,
      });
    });

    const ok = await signIn(email, password);
    expect(ok.status).toBe(200);

    const wrong = await signIn(email, "not the password");
    expect(wrong.status).toBe(401);
  });
});
