import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { closeDb, createDb, expenseRecurring, goalMilestones, goalProgressEvents, goalRewardRedemptions, goalRewards, goals, householdMembers, households, users, withHouseholdContext, withSystemContext, type Database } from "./index.js";

const url = process.env.HOSTED_TEST_DATABASE_URL;
(url ? describe : describe.skip)("Goals and recurring bill tenant isolation", () => {
  let db: Database;
  const hh: string[] = [], members: string[] = [], rewards: string[] = [], goalIds: string[] = [], milestones: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = createDb(url!);
    for (let i = 0; i < 2; i++) {
      await withSystemContext(db, async (tx) => {
        const [h] = await tx.insert(households).values({ name: `isolation-${randomUUID()}` }).returning(); hh.push(h.id);
        const [u] = await tx.insert(users).values({ username: `isolation-${randomUUID()}` }).returning(); userIds.push(u.id);
        const [m] = await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, name: "Synthetic" }).returning(); members.push(m.id);
      });
      await withHouseholdContext(db, hh[i], async (tx) => {
        const [r] = await tx.insert(goalRewards).values({ householdId: hh[i], title: "Reward" }).returning(); rewards.push(r.id);
        const [g] = await tx.insert(goals).values({ householdId: hh[i], ownerMemberId: members[i], title: "Goal" }).returning(); goalIds.push(g.id);
        const [s] = await tx.insert(goalMilestones).values({ goalId: g.id, title: "Milestone", threshold: 1, rewardId: r.id }).returning(); milestones.push(s.id);
        await tx.insert(goalProgressEvents).values({ householdId: hh[i], goalId: g.id, amount: 1 });
        await tx.insert(goalRewardRedemptions).values({ goalId: g.id, milestoneId: s.id, memberId: members[i], rewardId: r.id });
        await tx.insert(expenseRecurring).values({ householdId: hh[i], memberId: members[i], title: "Bill", amount: 1, anchorDate: "2026-01-01", nextAt: "2026-01-01" });
      });
    }
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, (tx) => tx.delete(households).where(inArray(households.id, hh)));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await closeDb(db);
  });
  it("hides every module table without tenant context and isolates both tenants", async () => {
    for (const table of [goals, goalRewards, goalMilestones, goalProgressEvents, goalRewardRedemptions, expenseRecurring]) {
      expect(await db.select().from(table)).toHaveLength(0);
      for (const id of hh) await withHouseholdContext(db, id, async (tx) => {
        expect(await tx.select().from(table)).toHaveLength(1);
      });
    }
  });
  it("rejects foreign owners, rewards, goals, members and mismatched milestone parents", async () => {
    const attempts = [
      (tx: Database) => tx.insert(goals).values({ householdId: hh[0], ownerMemberId: members[1], title: "Denied" }),
      (tx: Database) => tx.insert(goalMilestones).values({ goalId: goalIds[0], rewardId: rewards[1], threshold: 2, title: "Denied", sortOrder: 2 }),
      (tx: Database) => tx.insert(goalProgressEvents).values({ householdId: hh[0], goalId: goalIds[1], amount: 1 }),
      (tx: Database) => tx.insert(expenseRecurring).values({ householdId: hh[0], memberId: members[1], title: "Denied", amount: 1, anchorDate: "2026-01-01", nextAt: "2026-01-01" }),
      (tx: Database) => tx.insert(goalRewardRedemptions).values({ goalId: goalIds[0], milestoneId: milestones[1], rewardId: rewards[0], memberId: members[0] }),
      (tx: Database) => tx.update(goals).set({ householdId: hh[1] }).where(eq(goals.id, goalIds[0])),
    ];
    for (const attempt of attempts) await expect(withHouseholdContext(db, hh[0], (tx) => Promise.resolve(attempt(tx)))).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});
