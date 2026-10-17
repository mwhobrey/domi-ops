import { sql } from "drizzle-orm";
import { subscriptionAllowsWork } from "@domi-ops/config";
import { householdSubscriptions, households } from "./schema/index.js";
import { eq } from "drizzle-orm";
import { withHouseholdContext, withSystemContext } from "./tenant-context.js";
import type { Database } from "./client.js";

type Observation = { createdAt: Date; schoolInSevenDays: boolean; healthInSevenDays: boolean; hasSecondMember: boolean; activeAfterThirtyDays: boolean; canceled: boolean };
/** Counts only; small cohorts are suppressed so shared receipts do not identify one family. */
export function aggregateActivation(observations: Observation[]) {
  const cohorts = new Map<string, Observation[]>();
  for (const o of observations) { const month = o.createdAt.toISOString().slice(0, 7); cohorts.set(month, [...cohorts.get(month) ?? [], o]); }
  return [...cohorts].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => rows.length < 5
    ? { month, suppressed: true as const, households: null }
    : { month, suppressed: false as const, households: rows.length,
      schoolWithin7Days: rows.filter((r) => r.schoolInSevenDays).length,
      healthWithin7Days: rows.filter((r) => r.healthInSevenDays).length,
      secondActiveMember: rows.filter((r) => r.hasSecondMember).length,
      activeAfter30DaysSnapshot: rows.filter((r) => r.activeAfterThirtyDays).length,
      canceledSnapshot: rows.filter((r) => r.canceled).length });
}
/** Explicit operator report, restricted to households that opted into optional metrics.
 * No names, record text, IDs or event-level observations are returned or persisted. */
export async function hostedActivationReport(db: Database, now = new Date()) {
  const eligible = await withSystemContext(db, (tx) => tx.select({ id: households.id, createdAt: households.createdAt, tier: households.tier }).from(households).where(eq(households.telemetryOptIn, true)));
  const observations: Observation[] = [];
  for (const h of eligible.filter((h) => h.tier !== "self_host")) await withHouseholdContext(db, h.id, async (tx) => {
    const start = h.createdAt.toISOString(), end = new Date(h.createdAt.getTime() + 7 * 86400000).toISOString();
    const [counts] = await tx.execute<{ school: boolean; health: boolean; second: boolean }>(sql`
      select exists(select 1 from school_assignments a join school_classes c on c.id=a.class_id
        where c.household_id=${h.id} and a.created_at between ${start}::timestamptz and ${end}::timestamptz) as school,
      exists(select 1 from health_events where household_id=${h.id} and created_at between ${start}::timestamptz and ${end}::timestamptz) as health,
      (select count(distinct user_id) >= 2 from household_members where household_id=${h.id} and access_revoked_at is null) as second`);
    const [subscription] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, h.id));
    observations.push({ createdAt: h.createdAt, schoolInSevenDays: counts.school, healthInSevenDays: counts.health, hasSecondMember: counts.second,
      activeAfterThirtyDays: now.getTime() - h.createdAt.getTime() >= 30 * 86400000 && subscription?.status === "active" && subscriptionAllowsWork(subscription, now), canceled: subscription?.status === "canceled" });
  });
  return { generatedAt: now.toISOString(), population: "Opted-in hosted households only; not representative of all customers", limitations: ["Second member means membership, not a verified second login", "30-day activity is current subscription state, not a renewal receipt", "Acquisition, checkout abandonment, payment renewals and support burden require separate consented pilot/provider evidence"], cohorts: aggregateActivation(observations) };
}
