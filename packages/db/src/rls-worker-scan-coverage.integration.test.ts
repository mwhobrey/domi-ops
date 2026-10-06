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
 * - health_member_acl: read by the health reminder jobs, but those run per household under
 *   withHouseholdContext (see health-reminder-fanout.ts), so they never need cross-tenant access to
 *   who may see someone's health data. Keep it that way: do not give the worker a policy here.
 */
const NOT_READ_BY_WORKER_SCANS = new Set([
  "health_member_acl",
  // WHO-434: pharmacies, supply history, refill events, organizers and their reminders are read by the API and by the
  // per-household reminder job, both under withHouseholdContext. The scheduler's tick only needs to know which households
  // have a plan (health_organizer_plans) or a supply estimate (health_medication_supply), so those two keep a policy.
  "health_medication_dose_quantities",
  "health_medication_refill_events",
  "health_medication_supply_revisions",
  "health_organizer_compartments",
  "health_organizer_occurrence_events",
  "health_organizer_occurrences",
  "health_organizer_plan_caregivers",
  "health_organizer_session_fills",
  "health_organizer_sessions",
  "health_organizer_time_map",
  "health_pharmacies",
  "health_supply_fill_reminder_sent",
  "health_supply_refill_reminder_sent",
  "health_supply_settings",
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
});
