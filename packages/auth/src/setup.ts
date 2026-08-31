import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { baAccounts, householdMembers, households, users, withSystemContext } from "@domi-ops/db";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { hasImportRecords } from "./import-records.js";
import { getCanonicalHouseholdId } from "./single-tenant.js";

export const SETUP_GRANT_COOKIE = "domi-ops-setup-grant";
const SETUP_GRANT_TTL_SEC = 30 * 60;

export async function needsGreenfieldSetup(db: Database, env: Env): Promise<boolean> {
  if (env.DEPLOYMENT_MODE !== "single") return false;
  // households + import_records are RLS-scoped; bootstrap/status must see all rows.
  return withSystemContext(db, async (sysDb) => {
    if (await hasImportRecords(sysDb)) return false;
    return (await getCanonicalHouseholdId(sysDb)) === null;
  });
}

export function isSetupTokenConfigured(env: Env): boolean {
  return Boolean(env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 16);
}

export function verifySetupToken(env: Env, token: string | null | undefined): boolean {
  if (!isSetupTokenConfigured(env) || !token) return false;
  const expected = env.SETUP_TOKEN!;
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signSetupGrant(secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + SETUP_GRANT_TTL_SEC;
  const body = Buffer.from(JSON.stringify({ purpose: "setup", exp }), "utf8").toString("base64url");
  return `${body}.${signBody(secret, body)}`;
}

export function verifySetupGrant(secret: string, value: string | undefined | null): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = signBody(secret, body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      purpose?: string;
      exp?: number;
    };
    return payload.purpose === "setup" && (payload.exp ?? 0) >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function hasSetupAccess(
  env: Env,
  opts: { headerToken?: string | null; grantCookie?: string | null },
): boolean {
  if (env.ALLOW_PUBLIC_SIGNUP || env.DEMO_MODE) return true;
  if (verifySetupToken(env, opts.headerToken)) return true;
  if (env.SESSION_SECRET && verifySetupGrant(env.SESSION_SECRET, opts.grantCookie)) return true;
  return false;
}

export type GreenfieldOwnerInput = {
  email: string;
  password: string;
  name?: string;
  householdName?: string;
};

/** Headless / CLI — create first household + owner without a browser session. */
export async function bootstrapGreenfieldOwner(
  db: Database,
  env: Env,
  input: GreenfieldOwnerInput,
): Promise<{ userId: string; householdId: string }> {
  return withSystemContext(db, async (sysDb) => {
    if (!(await needsGreenfieldSetup(sysDb, env))) {
      throw new Error("Greenfield setup is not available (import or household already exists)");
    }

    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("A valid owner email is required");

    const [existing] = await sysDb.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new Error(`User already exists for ${email}`);

    const displayName = (input.name?.trim() || email.split("@")[0] || "Owner").slice(0, 128);
    const passwordHash = await hashPassword(input.password);

    const [household] = await sysDb
      .insert(households)
      .values({
        name: (input.householdName?.trim() || "Our Household").slice(0, 128),
        tier: "self_host",
        modulesEnabled: JSON.stringify(env.MODULES_ENABLED),
        storageQuotaBytes: env.DRIVE_DEFAULT_QUOTA_BYTES ?? null,
        timezone: "America/Chicago",
      })
      .returning();

    const [createdUser] = await sysDb
      .insert(users)
      .values({
        email,
        displayName,
        emailVerified: env.EMAIL_VERIFICATION_REQUIRED ? false : true,
      })
      .returning({ id: users.id });

    await sysDb.insert(baAccounts).values({
      userId: createdUser.id,
      providerId: "credential",
      // Better Auth's credential sign-in match is `account.accountId === user.id`, not the
      // email (see node_modules/better-auth/dist/api/routes/sign-in.mjs) - using email here
      // means the owner created by /setup could never sign back in after their session expired.
      // Found via WHO-250 (same bug in the demo-seed script, root-caused there first).
      accountId: createdUser.id,
      password: passwordHash,
    });

    await sysDb.insert(householdMembers).values({
      householdId: household.id,
      userId: createdUser.id,
      role: "owner",
      name: displayName,
    });

    return { userId: createdUser.id, householdId: household.id };
  });
}
