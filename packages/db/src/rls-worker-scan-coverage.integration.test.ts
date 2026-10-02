import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Database } from "./index.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

/**
 * Tables with row level security that deliberately have no `worker_scan` policy because no
 * cross-tenant worker scan reads them. Adding a table here is a decision: say why.
 *
 * - school_assignment_materials / school_hours_log / school_instruction_days: only ever read in the
 *   context of one household's request; no reminder or sync scan touches them.
 */
const NOT_READ_BY_WORKER_SCANS = new Set([
  "school_assignment_materials",
  "school_hours_log",
  "school_instruction_days",
]);

/**
 * WHO-403: `health_member_acl` had RLS but no worker_scan policy, so under the hosted RLS role the
 * reminder worker saw it as empty and silently skipped every caregiver. Nothing failed loudly. This
 * makes the next table added without a policy fail CI instead.
 */
maybeDescribe("worker_scan policy coverage (integration)", () => {
  let db: Database;

  beforeAll(() => {
    if (TEST_URL) db = createDb(TEST_URL);
  });
  afterAll(async () => {
    if (db) await closeDb(db);
  });

  it("every table with row level security has a worker_scan policy, unless it is explicitly listed as never scanned", async () => {
    const rows = await db.execute<{ relname: string }>(sql`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'worker_scan'
        )
      order by c.relname
    `);
    const missing = [...rows].map((r) => r.relname).filter((name) => !NOT_READ_BY_WORKER_SCANS.has(name));
    expect(missing).toEqual([]);
  });

  it("the allowlist only names tables that really lack the policy (so it can't go stale)", async () => {
    const rows = await db.execute<{ tablename: string }>(sql`
      select tablename from pg_policies where schemaname = 'public' and policyname = 'worker_scan'
    `);
    const have = new Set([...rows].map((r) => r.tablename));
    expect([...NOT_READ_BY_WORKER_SCANS].filter((name) => have.has(name))).toEqual([]);
  });

  it("the worker policy on health_member_acl can read but not write", async () => {
    const rows = await db.execute<{ cmd: string }>(sql`
      select cmd from pg_policies
      where schemaname = 'public' and tablename = 'health_member_acl' and policyname = 'worker_scan'
    `);
    expect([...rows].map((r) => r.cmd)).toEqual(["SELECT"]);
  });
});
