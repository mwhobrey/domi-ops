import type { Database } from "@domi-ops/db";
import { baAccounts, users } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";

/** Google account email for Drive sharing — prefers linked Google OAuth account. */
export async function resolveUserGoogleEmail(
  db: Database,
  userId: string,
): Promise<string | null> {
  const [googleAccount] = await db
    .select({ accountId: baAccounts.accountId })
    .from(baAccounts)
    .where(and(eq(baAccounts.userId, userId), eq(baAccounts.providerId, "google")))
    .limit(1);
  if (googleAccount?.accountId?.includes("@")) {
    return googleAccount.accountId;
  }

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.email ?? null;
}
