import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  healthMemberAcl,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { hasHealthSegmentAccess } from "./health-access.js";

/**
 * WHO-454: `hasHealthSegmentAccess` used to let any owner or admin through for any member id, in any
 * household. Runs in the caller's household context, as the routes do, so the membership lookup is
 * under RLS exactly like production. Skipped without a database.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

type Role = "owner" | "admin" | "member" | "child";
type Person = { memberId: string; householdId: string; role: Role };

maybeDescribe("hasHealthSegmentAccess (integration)", () => {
  let db: Database;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, Person> = {};

  async function seed(name: string, members: { key: string; role: Role }[]) {
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdIds.push(hh!.id);
      for (const m of members) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who454-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u!.id);
        const [row] = await tx
          .insert(householdMembers)
          .values({ householdId: hh!.id, userId: u!.id, role: m.role, name: m.key })
          .returning({ id: householdMembers.id });
        people[m.key] = { memberId: row!.id, householdId: hh!.id, role: m.role };
      }
    });
  }

  /** Ask as `who`, inside their own household's context. */
  const can = (who: string, subject: string, level: "read" | "write" = "write", segment: "events" | "medications" = "events") => {
    const p = people[who]!;
    return withHouseholdContext(db, p.householdId, (tx) =>
      hasHealthSegmentAccess(tx, { householdId: p.householdId, memberId: p.memberId, role: p.role }, people[subject]?.memberId ?? subject, segment, level),
    );
  };

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await seed("who454-a", [
      { key: "ownerA", role: "owner" },
      { key: "adminA", role: "admin" },
      { key: "kidA", role: "child" },
      { key: "sitterA", role: "member" },
      { key: "readerA", role: "member" },
    ]);
    await seed("who454-b", [
      { key: "ownerB", role: "owner" },
      { key: "kidB", role: "child" },
    ]);
    await withHouseholdContext(db, people.ownerA!.householdId, (tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId: people.ownerA!.householdId, subjectMemberId: people.kidA!.memberId, granteeMemberId: people.sitterA!.memberId, eventsAccess: "write" },
        { householdId: people.ownerA!.householdId, subjectMemberId: people.kidA!.memberId, granteeMemberId: people.readerA!.memberId, eventsAccess: "read" },
      ]),
    );
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(db);
  });

  it("lets an owner or admin manage anyone in their own household", async () => {
    expect(await can("ownerA", "kidA")).toBe(true);
    expect(await can("adminA", "kidA")).toBe(true);
    expect(await can("adminA", "sitterA", "write", "medications")).toBe(true);
  });

  it("does not let an owner or admin manage a member of another household", async () => {
    expect(await can("ownerA", "kidB")).toBe(false);
    expect(await can("adminA", "kidB")).toBe(false);
    expect(await can("ownerB", "kidA")).toBe(false);
    expect(await can("ownerA", "kidB", "read")).toBe(false);
  });

  it("does not let an admin through for an id that is not a member at all", async () => {
    expect(await can("ownerA", randomUUID())).toBe(false);
    expect(await can("ownerA", "not-a-uuid")).toBe(false);
  });

  it("always lets someone manage themselves", async () => {
    for (const who of ["ownerA", "kidA", "sitterA", "kidB"]) expect(await can(who, who)).toBe(true);
  });

  it("still follows the ACL for everyone who is not an admin", async () => {
    expect(await can("sitterA", "kidA", "write")).toBe(true);
    expect(await can("readerA", "kidA", "read")).toBe(true);
    expect(await can("readerA", "kidA", "write")).toBe(false);
    expect(await can("sitterA", "kidA", "write", "medications")).toBe(false);
    expect(await can("kidA", "sitterA")).toBe(false);
    expect(await can("sitterA", "kidB")).toBe(false);
  });
});
