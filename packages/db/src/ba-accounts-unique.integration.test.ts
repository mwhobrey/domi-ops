import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb } from "./index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const MIGRATION = readFileSync(new URL("../drizzle/0093_ba_accounts_unique_provider_account.sql", import.meta.url), "utf8");

/**
 * WHO-449, migration 0093: Better Auth 1.7.3+ refuses to sign in a Google account that has two rows, and 1.7.2 could leave
 * two (the backfilled "local:oauth:google" row and the one it wrote itself). The migration keeps one per person and makes
 * the pair unique. The SQL file itself is run here against a temporary copy of the table, which shadows the real one for the
 * session, so the duplicate shapes can exist at all (the real table now forbids them).
 */
maybeDescribe("ba_accounts unique provider account (migration 0093)", () => {
  let db: Database;

  beforeAll(() => {
    if (TEST_URL) db = createDb(TEST_URL);
  });
  afterAll(async () => {
    if (db) await closeDb(db);
  });

  type Row = { id?: string; userId: string; providerId: string; accountId: string; issuer?: string | null; refreshToken?: string | null; updatedAt?: string };

  /** Runs `body` in a transaction where `ba_accounts` is an empty temporary copy of the real table (no indexes, no foreign keys). */
  async function withTempAccounts<T>(rows: Row[], body: (tx: Database) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql.raw(`create temp table ba_accounts (like public.ba_accounts including defaults) on commit drop`));
      for (const r of rows) {
        await tx.execute(sql`
          insert into ba_accounts (id, user_id, provider_id, account_id, issuer, refresh_token, updated_at)
          values (${r.id ?? randomUUID()}, ${r.userId}, ${r.providerId}, ${r.accountId}, ${r.issuer ?? null}, ${r.refreshToken ?? null},
                  ${r.updatedAt ?? "2026-10-01T00:00:00Z"})`);
      }
      await tx.execute(sql.raw(MIGRATION));
      return body(tx as unknown as Database);
    });
  }

  const idsLeft = async (tx: Database) => (await tx.execute<{ id: string }>(sql`select id from ba_accounts order by id`)).map((r) => r.id);

  it("keeps the row Better Auth wrote over the backfilled one", async () => {
    const user = randomUUID();
    const backfilled = randomUUID();
    const real = randomUUID();
    const left = await withTempAccounts(
      [
        { id: backfilled, userId: user, providerId: "google", accountId: "sub-1", issuer: "local:oauth:google", refreshToken: "rt", updatedAt: "2026-10-05T00:00:00Z" },
        { id: real, userId: user, providerId: "google", accountId: "sub-1", issuer: "https://accounts.google.com" },
      ],
      idsLeft,
    );
    expect(left).toEqual([real]);
  });

  it("then prefers a row holding a refresh token, then the most recently updated", async () => {
    const user = randomUUID();
    const bare = randomUUID();
    const withToken = randomUUID();
    const left = await withTempAccounts(
      [
        { id: bare, userId: user, providerId: "google", accountId: "sub-2", issuer: "https://accounts.google.com", updatedAt: "2026-10-06T00:00:00Z" },
        { id: withToken, userId: user, providerId: "google", accountId: "sub-2", issuer: "https://accounts.google.com", refreshToken: "rt", updatedAt: "2026-09-01T00:00:00Z" },
      ],
      idsLeft,
    );
    expect(left).toEqual([withToken]);

    const older = randomUUID();
    const newer = randomUUID();
    const byDate = await withTempAccounts(
      [
        { id: older, userId: user, providerId: "google", accountId: "sub-3", issuer: "https://accounts.google.com", updatedAt: "2026-09-01T00:00:00Z" },
        { id: newer, userId: user, providerId: "google", accountId: "sub-3", issuer: "https://accounts.google.com", updatedAt: "2026-10-01T00:00:00Z" },
      ],
      idsLeft,
    );
    expect(byDate).toEqual([newer]);
  });

  it("leaves everything else alone: other people, other providers, password rows, rows with no duplicate", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const rows: Row[] = [
      { id: randomUUID(), userId: a, providerId: "google", accountId: "sub-a" },
      { id: randomUUID(), userId: b, providerId: "google", accountId: "sub-b" },
      { id: randomUUID(), userId: a, providerId: "credential", accountId: a, issuer: "local:credential" },
      { id: randomUUID(), userId: a, providerId: "apple", accountId: "sub-a" },
    ];
    const left = await withTempAccounts(rows, idsLeft);
    expect(left).toEqual(rows.map((r) => r.id!).sort());
  });

  it("makes the provider account unique, so the duplicate cannot come back", async () => {
    const user = randomUUID();
    const outcome = await withTempAccounts([{ userId: user, providerId: "google", accountId: "sub-4" }], async (tx) => {
      const index = await tx.execute<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where indexname = 'ba_accounts_provider_account_uidx' and schemaname like 'pg_temp%'`,
      );
      let rejected = false;
      try {
        // A nested transaction (a savepoint), so the error we expect does not poison the outer one.
        await tx.transaction(async (inner) => {
          await inner.execute(sql`insert into ba_accounts (id, user_id, provider_id, account_id) values (${randomUUID()}, ${user}, 'google', 'sub-4')`);
        });
      } catch {
        rejected = true;
      }
      return { indexdef: index[0]?.indexdef ?? "", rejected };
    });
    expect(outcome.indexdef).toMatch(/UNIQUE INDEX/);
    expect(outcome.indexdef).toMatch(/provider_id, account_id/);
    expect(outcome.rejected).toBe(true);
  });

  it("does not delete or fail when two different people share one provider account, and says it skipped the index", async () => {
    const rows: Row[] = [
      { id: randomUUID(), userId: randomUUID(), providerId: "google", accountId: "shared" },
      { id: randomUUID(), userId: randomUUID(), providerId: "google", accountId: "shared" },
    ];
    const result = await withTempAccounts(rows, async (tx) => {
      const index = await tx.execute(sql`select 1 from pg_indexes where indexname = 'ba_accounts_provider_account_uidx' and schemaname like 'pg_temp%'`);
      return { left: await idsLeft(tx), indexRows: index.length };
    });
    expect(result.left).toEqual(rows.map((r) => r.id!).sort());
    expect(result.indexRows).toBe(0);
  });

  it("is in place on the real table", async () => {
    const rows = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'ba_accounts' and indexname = 'ba_accounts_provider_account_uidx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX .*\(provider_id, account_id\)/);
  });
});
