import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { closeDb, createDb, healthEvents, householdMembers, households, householdSubscriptions, schoolAssignments, schoolClasses, users, withHouseholdContext, withSystemContext, type Database } from "./index.js";
import { hostedActivationReport } from "./hosted-activation.js";
const url = process.env.HOSTED_TEST_DATABASE_URL;
(url ? describe : describe.skip)("hosted activation aggregate privacy", () => {
  let db: Database;
  const hh: string[] = [], userIds: string[] = [];
  beforeAll(async () => {
    db = createDb(url!);
    for (let i = 0; i < 7; i++) await withSystemContext(db, async (tx) => {
      const [h] = await tx.insert(households).values({ name: `private-activation-${randomUUID()}`, tier: "hosted_starter", telemetryOptIn: i !== 5, createdAt: new Date(i === 6 ? "1989-01-01Z" : "1990-01-01Z") }).returning(); hh.push(h.id);
      const [u] = await tx.insert(users).values({ username: `activation-${randomUUID()}` }).returning(); userIds.push(u.id);
      const [m] = await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: "owner" }).returning();
      await tx.insert(householdSubscriptions).values({ householdId: h.id, status: "active", modulesEntitled: '["core","school","health"]', currentPeriodEnd: new Date("2100-01-01Z") });
      if (i === 0 || i === 5) await withHouseholdContext(tx, h.id, async (tenant) => {
        const [cl] = await tenant.insert(schoolClasses).values({ householdId: h.id, name: "Sensitive course name", teacherMemberId: m.id }).returning();
        await tenant.insert(schoolAssignments).values({ classId: cl.id, title: "Sensitive assignment name", createdAt: new Date("1990-01-02Z") });
        await tenant.insert(healthEvents).values({ householdId: h.id, memberId: m.id, title: "Sensitive health content", createdAt: new Date("1990-01-03Z") });
        const [second] = await tenant.insert(users).values({ username: `activation-${randomUUID()}` }).returning(); userIds.push(second.id);
        await tenant.insert(householdMembers).values({ householdId: h.id, userId: second.id, role: "member" });
      });
    });
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => { await tx.delete(households).where(inArray(households.id, hh)); await tx.delete(users).where(inArray(users.id, userIds)); }); await closeDb(db);
  });
  it("excludes opt-outs, suppresses small cohorts and returns counts without identities or record text", async () => {
    const report = await hostedActivationReport(db, new Date("1990-02-05Z"));
    expect(report.cohorts.find((c) => c.month === "1990-01")).toMatchObject({ households: 5, schoolWithin7Days: 1, healthWithin7Days: 1, secondActiveMember: 1, activeAfter30DaysSnapshot: 5 });
    expect(report.cohorts.find((c) => c.month === "1989-01")).toEqual({ month: "1989-01", suppressed: true, households: null });
    for (const marker of [...hh, ...userIds, "Sensitive", "private-activation"]) expect(JSON.stringify(report)).not.toContain(marker);
  });
});
