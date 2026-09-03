import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { users } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import { bootstrapHouseholdOnLogin, resolveAuthContext } from "./bootstrap.js";
import { getImportedHouseholdId, hasImportRecords } from "./import-records.js";
import { joinImportedHousehold } from "./join-imported.js";
import { tryClaimImportedStubMember } from "./claim-imported-stub.js";
import { repairSingleTenantMembership } from "./single-tenant.js";

function profileFromUser(user: {
  email: string | null;
  displayName: string | null;
  imageUrl: string | null;
  emailVerified: boolean;
  username: string | null;
}) {
  return {
    email: user.email ?? undefined,
    displayName: user.displayName ?? undefined,
    imageUrl: user.imageUrl ?? undefined,
    emailVerified: user.emailVerified,
    username: user.username ?? undefined,
  };
}

/** Idempotent: attach session user to imported or new household. */
export async function ensureHouseholdMembership(
  db: Database,
  env: Env,
  userId: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  if (await hasImportRecords(db)) {
    const importedHouseholdId = await getImportedHouseholdId(db);
    if (!importedHouseholdId) {
      await bootstrapHouseholdOnLogin(db, env, userId);
      return;
    }

    const existing = await resolveAuthContext(db, userId);
    const profile = profileFromUser(user);

    if (existing?.householdId === importedHouseholdId) {
      await tryClaimImportedStubMember(db, env, importedHouseholdId, userId, profile);
      return;
    }

    if (!user.email && !user.username) {
      throw new Error("Imported household join requires an email or username account");
    }

    await joinImportedHousehold(db, env, { ...profile, userId });
    return;
  }

  if (await repairSingleTenantMembership(db, env, userId)) return;

  const existing = await resolveAuthContext(db, userId);
  if (existing) return;

  // Hosted (DEPLOYMENT_MODE=shared|dedicated): a signed-in user with no household simply
  // hasn't completed Stripe checkout yet. That's a valid pending state — the web layer
  // redirects them to /pricing, and /api/billing/hosted-setup/complete attaches them to the
  // household the webhook provisions. Only single-tenant self-host auto-creates a household
  // on first login; bootstrapHouseholdOnLogin throws for anything else, which used to escape
  // the Better Auth session hook and blank-screen the OAuth callback (WHO-277).
  if (env.DEPLOYMENT_MODE !== "single") return;

  await bootstrapHouseholdOnLogin(db, env, userId);
}
