import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { bootstrapHouseholdOnLogin, findOrCreateUser } from "./bootstrap.js";
import { hasImportRecords } from "./import-records.js";
import { joinImportedHousehold } from "./join-imported.js";

export async function resolveLoginUserAndHousehold(
  db: Database,
  env: Env,
  profile: { email: string; displayName?: string; imageUrl?: string; emailVerified?: boolean },
): Promise<{ userId: string; householdId: string }> {
  if (await hasImportRecords(db)) {
    return joinImportedHousehold(db, env, profile);
  }
  const user = await findOrCreateUser(db, profile);
  const householdId = await bootstrapHouseholdOnLogin(db, env, user.id);
  return { userId: user.id, householdId };
}
