import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { closeDb, createDb, households, withHouseholdContext, withSystemContext, type Database } from "./index.js";
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

maybeDescribe("nested database context boundaries", () => {
  let db: Database;
  const ids: string[] = [];
  beforeAll(async () => {
    db = createDb(TEST_URL!);
    await withSystemContext(db, async (tx) => {
      for (const name of ["nested-alpha", "nested-beta"]) {
        const [h] = await tx.insert(households).values({ name }).returning(); ids.push(h.id);
      }
    });
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, (tx) => tx.delete(households).where(inArray(households.id, ids)));
    await closeDb(db);
  });
  const visible = (tx: Database) => tx.select({ id: households.id }).from(households).where(inArray(households.id, ids));

  it("restores tenant restrictions after a successful nested privileged operation", async () => {
    await withHouseholdContext(db, ids[0], async (tx) => {
      expect(await visible(tx)).toEqual([{ id: ids[0] }]);
      expect(await withSystemContext(tx, visible)).toHaveLength(2);
      expect(await visible(tx)).toEqual([{ id: ids[0] }]);
    });
  });
  it("restores the previous household after nested work", async () => {
    await withHouseholdContext(db, ids[0], async (tx) => {
      expect(await withHouseholdContext(tx, ids[1], visible)).toEqual([{ id: ids[1] }]);
      expect(await visible(tx)).toEqual([{ id: ids[0] }]);
    });
  });
  it("restores restrictions after a nested SQL error without hiding the error", async () => {
    await withHouseholdContext(db, ids[0], async (tx) => {
      await expect(withSystemContext(tx, (inner) => inner.execute(sql`select 1 / 0`))).rejects.toThrow();
      expect(await visible(tx)).toEqual([{ id: ids[0] }]);
    });
  });
});
