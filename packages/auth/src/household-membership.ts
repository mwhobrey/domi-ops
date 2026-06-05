import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { users } from "@whome/db";
import { eq } from "drizzle-orm";
import { bootstrapHouseholdOnLogin, resolveAuthContext } from "./bootstrap.js";
import { hasImportRecords } from "./import-records.js";
import { joinImportedHousehold } from "./join-imported.js";

/** Idempotent: attach session user to imported or new household. */
export async function ensureHouseholdMembership(
  db: Database,
  env: Env,
  userId: string,
): Promise<void> {
  const existing = await resolveAuthContext(db, userId);
  if (existing) return;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  if (await hasImportRecords(db)) {
    if (!user.email) {
      throw new Error("Imported household join requires an email-based account");
    }
    await joinImportedHousehold(db, env, {
      email: user.email,
      displayName: user.displayName ?? undefined,
      imageUrl: user.imageUrl ?? undefined,
      emailVerified: user.emailVerified,
    });
    return;
  }

  await bootstrapHouseholdOnLogin(db, env, userId);
}
