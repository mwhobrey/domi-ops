import { isHostedDeployment, subscriptionAllowsWork, type Env } from "@domi-ops/config";
import { householdSubscriptions, withHouseholdContext, type Database } from "@domi-ops/db";
import { eq } from "drizzle-orm";

export async function householdSubscriptionAllowsWork(db: Database, env: Env, householdId: string) {
  if (!isHostedDeployment(env)) return true;
  return withHouseholdContext(db, householdId, async (tx) => {
    const [subscription] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, householdId)).limit(1);
    return subscriptionAllowsWork(subscription ?? null);
  });
}
