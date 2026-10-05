import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthEvents,
  healthMedicationGroupMembers,
  healthMedicationGroups,
  healthMedications,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { buildHealthEventOverlays, buildMedicationDoseOverlays } from "./calendar-overlays.js";

/**
 * WHO-411: the calendar's "For {person}" filter keeps a chip only when it lists that person in
 * `attendeeMemberIds`. Health check chips always did; medication dose chips (single and group) and
 * health event chips did not, so filtering by a person could hide that person's own doses. Runs as
 * the app role against a real Postgres; skipped without one.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {
  MODULES_ENABLED: ["core", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ENCRYPTION_KEY: "test-health-encryption-key-32chars!!",
} as unknown as Env;

maybeDescribe("calendar overlay attendees (integration)", () => {
  let db: Database;
  let householdId = "";
  let userId = "";
  let momMemberId = "";
  let allyMemberId = "";
  let dadMemberId = "";
  const userIds: string[] = [];

  const day = new Date().toISOString().slice(0, 10);
  const auth = () => ({ householdId, userId, memberId: momMemberId, role: "owner" });

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "who411-home", timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdId = hh.id;
      const member = async (name: string, role: "owner" | "child" | "admin") => {
        const [u] = await tx
          .insert(users)
          .values({ email: `who411-${randomUUID()}@test.local`, displayName: name, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u.id);
        const [m] = await tx
          .insert(householdMembers)
          .values({ householdId, userId: u.id, role, name })
          .returning({ id: householdMembers.id });
        return { userId: u.id, memberId: m.id };
      };
      const mom = await member("mom", "owner");
      userId = mom.userId;
      momMemberId = mom.memberId;
      allyMemberId = (await member("ally", "child")).memberId;
      dadMemberId = (await member("dad", "admin")).memberId;
    });
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(db);
  });

  // Noon UTC so a "08:00" dose is already past and "20:00" still ahead, whatever time the run starts.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${day}T12:00:00.000Z`));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await withHouseholdContext(db, householdId, async (tx) => {
      await tx.delete(healthMedicationGroups).where(eq(healthMedicationGroups.householdId, householdId));
      await tx.delete(healthMedications).where(eq(healthMedications.householdId, householdId));
      await tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId));
    });
  });

  const addMed = (memberId: string, name: string, schedule: object) =>
    withHouseholdContext(db, householdId, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId,
          name,
          scheduleKind: "scheduled",
          scheduleJson: JSON.stringify(schedule),
          visibility: "household",
        })
        .returning({ id: healthMedications.id });
      return m.id;
    });

  const doses = () =>
    withHouseholdContext(db, householdId, (tx) => buildMedicationDoseOverlays(tx, env, auth(), day, day));

  it("lists the person a single medication dose is for", async () => {
    const allyMed = await addMed(allyMemberId, "who411 ally med", { times: ["20:00"] });
    const dadMed = await addMed(dadMemberId, "who411 dad med", { times: ["20:30"] });
    const chips = await doses();
    expect(chips.find((c) => c.id.includes(allyMed))?.attendeeMemberIds).toEqual([allyMemberId]);
    expect(chips.find((c) => c.id.includes(dadMed))?.attendeeMemberIds).toEqual([dadMemberId]);
  });

  it("lists the person a medication group dose is for", async () => {
    const med = await addMed(allyMemberId, "who411 grouped med", { times: ["20:00"] });
    const groupId = await withHouseholdContext(db, householdId, async (tx) => {
      const [g] = await tx
        .insert(healthMedicationGroups)
        .values({
          householdId,
          memberId: allyMemberId,
          name: "who411 evening",
          scheduleKind: "scheduled",
          scheduleJson: JSON.stringify({ times: ["20:00"] }),
          visibility: "household",
        })
        .returning({ id: healthMedicationGroups.id });
      await tx.insert(healthMedicationGroupMembers).values({ groupId: g.id, medicationId: med });
      return g.id;
    });
    const chip = (await doses()).find((c) => c.id.includes(`medgroup:${groupId}`));
    expect(chip?.attendeeMemberIds).toEqual([allyMemberId]);
  });

  const INTERVAL = { everyMinutes: 240, anchor: "first_taken", stop: { mode: "midnight" } };

  it("lists the person an interval medication dose is for", async () => {
    const id = await withHouseholdContext(db, householdId, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId: dadMemberId,
          name: "who411 interval med",
          scheduleKind: "interval",
          scheduleJson: JSON.stringify(INTERVAL),
          visibility: "household",
        })
        .returning({ id: healthMedications.id });
      return m.id;
    });
    const chips = (await doses()).filter((c) => c.id.includes(id));
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c.attendeeMemberIds).toEqual([dadMemberId]);
  });

  it("lists the person an interval medication group dose is for", async () => {
    const med = await addMed(dadMemberId, "who411 interval grouped med", { times: [] });
    const groupId = await withHouseholdContext(db, householdId, async (tx) => {
      const [g] = await tx
        .insert(healthMedicationGroups)
        .values({
          householdId,
          memberId: dadMemberId,
          name: "who411 interval group",
          scheduleKind: "interval",
          scheduleJson: JSON.stringify(INTERVAL),
          visibility: "household",
        })
        .returning({ id: healthMedicationGroups.id });
      await tx.insert(healthMedicationGroupMembers).values({ groupId: g.id, medicationId: med });
      return g.id;
    });
    const chips = (await doses()).filter((c) => c.id.includes(`medgroup:${groupId}`));
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c.attendeeMemberIds).toEqual([dadMemberId]);
  });

  it("lists the person a health event is for", async () => {
    const id = await withHouseholdContext(db, householdId, async (tx) => {
      const [e] = await tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId: allyMemberId,
          type: "symptom",
          title: "who411 headache",
          startedAt: new Date(`${day}T09:30:00.000Z`),
          visibility: "household",
        })
        .returning({ id: healthEvents.id });
      return e.id;
    });
    const chips = await withHouseholdContext(db, householdId, (tx) =>
      buildHealthEventOverlays(tx, env, auth(), day, day),
    );
    expect(chips.find((c) => c.id.includes(id))?.attendeeMemberIds).toEqual([allyMemberId]);
  });
});
