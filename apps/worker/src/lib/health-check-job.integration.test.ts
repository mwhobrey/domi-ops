import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb, createDb, healthChecks, healthEvents, healthVitalsReadings,
  healthWithingsMeasureGroups, householdMembers, households, userNotifications, users,
  withHouseholdContext, withSystemContext, type Database,
} from "@domi-ops/db";
import { runHouseholdSyncJob } from "./household-sync-job.js";

const url = process.env.HOSTED_TEST_DATABASE_URL;
(url ? describe : describe.skip)("Withings completion in the household reminder job", () => {
  let db: Database;
  let householdId: string;
  let userId: string;
  let watchEventId: string;
  const env = { DEPLOYMENT_MODE: "single", ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T17:38:00Z"));
    db = createDb(url!);
    const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 33 * 60_000);
    await withSystemContext(db, async tx => {
      const [household] = await tx.insert(households).values({
        name: "withings-job-fixture", timezone: "UTC", modulesEnabled: JSON.stringify(["health"]),
      }).returning();
      householdId = household.id;
      const [user] = await tx.insert(users).values({
        email: `withings-job-${randomUUID()}@example.test`, pushHealthRemindersEnabled: true,
      }).returning();
      userId = user.id;
    });
    await withHouseholdContext(db, householdId, async tx => {
      const [member] = await tx.insert(householdMembers).values({ householdId, userId, role: "owner", name: "Fixture" }).returning();
      await tx.insert(healthChecks).values({
        householdId, memberId: member.id, name: "Fixture vitals", eventType: "vitals",
        templateJson: JSON.stringify({ metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "temperature"] }),
        scheduleJson: JSON.stringify({ times: [slot.toISOString().slice(11, 16)] }),
        reminderOffsetsJson: "[0]",
      });
      for (const [offset, metrics] of [[20, ["blood_pressure_systolic", "blood_pressure_diastolic"]], [32, ["temperature"]]] as const) {
        const [event] = await tx.insert(healthEvents).values({
          householdId, memberId: member.id, type: "vitals", title: "Synthetic device entry",
          startedAt: new Date(slot.getTime() + offset * 60_000),
        }).returning();
        if (offset === 32) watchEventId = event.id;
        for (const metric of metrics) await tx.insert(healthVitalsReadings).values({ eventId: event.id, metric, value: "1", unit: "x" });
        await tx.insert(healthWithingsMeasureGroups).values({
          householdId, memberId: member.id, withingsUserId: "fixture", grpid: randomUUID(), eventId: event.id,
        });
      }
    });
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (!db) return;
    await withSystemContext(db, async tx => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      if (userId) await tx.delete(users).where(eq(users.id, userId));
    });
    await closeDb(db);
  });

  it("reads private provenance through the real worker wrapper and suppresses a completed check's reminder", async () => {
    expect(await db.select().from(healthWithingsMeasureGroups).where(eq(healthWithingsMeasureGroups.householdId, householdId))).toEqual([]);
    await runHouseholdSyncJob(db, env, "health.check.reminder.household", { householdId });
    const notices = () => withHouseholdContext(db, householdId, tx => tx.select().from(userNotifications).where(eq(userNotifications.userId, userId)));
    expect(await notices()).toHaveLength(0);

    // Positive control: the same job must nudge once the complementary watch entry is gone.
    await withHouseholdContext(db, householdId, tx => tx.delete(healthEvents).where(eq(healthEvents.id, watchEventId)));
    await runHouseholdSyncJob(db, env, "health.check.reminder.household", { householdId });
    expect(await notices()).toHaveLength(1);
  });
});
