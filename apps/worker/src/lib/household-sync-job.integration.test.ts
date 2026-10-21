import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { calendarConnections, calendars, closeDb, createDb, households, linkedGoogleCalendars, users, withHouseholdContext, withSystemContext, type Database } from "@domi-ops/db";
import { runHouseholdSyncJob } from "./household-sync-job.js";

vi.mock("../../../../packages/calendar-sync/dist/client.js", async original => ({
  ...await original<typeof import("../../../../packages/calendar-sync/dist/client.js")>(),
  ensureAccessToken: vi.fn(async () => "synthetic-token"),
  googleCalendarFetch: vi.fn(async () => { throw new Error("Synthetic Google network failure"); }),
}));
const URL = process.env.HOSTED_TEST_DATABASE_URL;
(URL ? describe : describe.skip)("Calendar job failure survives transaction rollback", () => {
  let db: Database;
  let householdId: string;
  let userId: string;
  let connectionId: string;
  beforeAll(async () => {
    db = createDb(URL!);
    await withSystemContext(db, async tx => {
      [householdId] = (await tx.insert(households).values({ name: `calendar-job-${randomUUID()}` }).returning()).map(h => h.id);
      [userId] = (await tx.insert(users).values({ email: `calendar-job-${randomUUID()}@example.test` }).returning()).map(u => u.id);
    });
    await withHouseholdContext(db, householdId, async tx => {
      const [cal] = await tx.insert(calendars).values({ householdId, name: "Synthetic" }).returning();
      const [conn] = await tx.insert(calendarConnections).values({ householdId, userId, refreshTokenEnc: "fixture", syncMode: "bidirectional", syncRunStatus: "queued" }).returning();
      connectionId = conn.id;
      await tx.insert(linkedGoogleCalendars).values({ connectionId, targetCalendarId: cal.id, googleCalendarId: "synthetic" });
    });
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async tx => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      if (userId) await tx.delete(users).where(eq(users.id, userId));
    });
    await closeDb(db);
  });
  it("commits a visible failed status after a failed Google pull rolls back", async () => {
    await expect(runHouseholdSyncJob(db, { DEPLOYMENT_MODE: "single" } as Env, "google.calendar.full_import", { householdId, connectionId })).rejects.toThrow("Synthetic Google network failure");
    const [conn] = await withHouseholdContext(db, householdId, tx => tx.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)));
    expect(conn.syncRunStatus).toBe("failed");
    expect(conn.syncRunError).toContain("Calendar sync could not finish");
  });
});
