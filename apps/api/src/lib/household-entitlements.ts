import { parseHouseholdModulesJson } from "@domi-ops/config";
import type { SubscriptionAccessState } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdSubscriptions, households } from "@domi-ops/db";
import { eq } from "drizzle-orm";

export type HouseholdModuleContext = {
  modules: string[];
  modulesEntitled: string[] | null;
  subscription: SubscriptionAccessState | null;
};

export async function getHouseholdModuleContext(
  db: Database,
  householdId: string,
): Promise<HouseholdModuleContext> {
  const [row] = await db
    .select({
      modulesEnabled: households.modulesEnabled,
      modulesEntitled: householdSubscriptions.modulesEntitled,
      status: householdSubscriptions.status,
      trialEndsAt: householdSubscriptions.trialEndsAt,
      currentPeriodEnd: householdSubscriptions.currentPeriodEnd,
      pastDueSince: householdSubscriptions.pastDueSince,
    })
    .from(households)
    .leftJoin(householdSubscriptions, eq(householdSubscriptions.householdId, households.id))
    .where(eq(households.id, householdId))
    .limit(1);

  if (!row) {
    return { modules: ["core"], modulesEntitled: null, subscription: null };
  }

  return {
    subscription: row.status ? { status: row.status, trialEndsAt: row.trialEndsAt, currentPeriodEnd: row.currentPeriodEnd, pastDueSince: row.pastDueSince } : null,
    modules: parseHouseholdModulesJson(row.modulesEnabled),
    modulesEntitled: row.modulesEntitled
      ? parseHouseholdModulesJson(row.modulesEntitled)
      : null,
  };
}
