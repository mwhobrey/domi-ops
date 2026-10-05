import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, withSystemContext } from "./index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

/**
 * Migration 0086: "this person's entries of one kind between two instants" is what slot status, the
 * reports, the calendar, the dashboard and the reminder worker all ask of `health_events`, and the
 * table had only its primary key. This keeps the index there, and keeps it usable for that exact
 * shape of query (the planner is told not to scan, so a small test table can't hide a missing or
 * unusable index).
 */
maybeDescribe("health_events lookup index (integration)", () => {
  let db: Database;

  beforeAll(() => {
    if (TEST_URL) db = createDb(TEST_URL);
  });
  afterAll(async () => {
    if (db) await closeDb(db);
  });

  it("has the household / person / kind / time index", async () => {
    const rows = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'health_events'
        and indexname = 'health_events_household_member_type_started_idx'
    `);
    const def = [...rows][0]?.indexdef ?? "";
    expect(def).toContain("(household_id, member_id, type, started_at)");
  });

  it("is what a person's vitals-in-a-range lookup runs on", async () => {
    // A transaction so `set local` cannot leak onto the pooled connection.
    const plan = await withSystemContext(db, async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = await tx.execute<{ "QUERY PLAN": string }>(sql`
        explain
        select id from health_events
        where household_id = '00000000-0000-0000-0000-000000000001'
          and member_id in ('00000000-0000-0000-0000-000000000002')
          and type in ('vitals')
          and started_at between '2026-10-01' and '2026-10-02'
      `);
      return [...rows].map((r) => r["QUERY PLAN"]).join("\n");
    });
    expect(plan).toContain("health_events_household_member_type_started_idx");
  });
});
