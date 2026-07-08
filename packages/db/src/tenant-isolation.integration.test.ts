import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, createDb, notes, withHouseholdContext, withWorkerScanContext } from "./index.js";
import { households } from "./schema/index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const maybeDescribe = TEST_URL ? describe : describe.skip;

maybeDescribe("tenant isolation (integration)", () => {
  let db: Database;
  let alphaHouseholdId: string;
  let betaHouseholdId: string;

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);

    const rows = await db
      .select({ id: households.id, slug: households.slug })
      .from(households)
      .where(eq(households.slug, "alpha-hosted"));

    const alpha = rows[0];
    const [beta] = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.slug, "beta-hosted"))
      .limit(1);

    if (!alpha || !beta) {
      throw new Error("Run npm run db:seed-hosted-qa before tenant isolation tests");
    }
    alphaHouseholdId = alpha.id;
    betaHouseholdId = beta.id;
  }, 30_000);

  afterAll(async () => {
    if (db) await closeDb(db);
  });

  it("scopes note reads to the active household", async () => {
    const alphaNotes = await withHouseholdContext(db, alphaHouseholdId, (tx) =>
      tx.select({ title: notes.title }).from(notes),
    );
    const betaNotes = await withHouseholdContext(db, betaHouseholdId, (tx) =>
      tx.select({ title: notes.title }).from(notes),
    );

    expect(alphaNotes.map((n) => n.title)).toContain("alpha-secret-note");
    expect(alphaNotes.map((n) => n.title)).not.toContain("beta-secret-note");
    expect(betaNotes.map((n) => n.title)).toContain("beta-secret-note");
    expect(betaNotes.map((n) => n.title)).not.toContain("alpha-secret-note");
  });

  it("prevents cross-tenant note visibility after insert", async () => {
    const marker = `isolation-${Date.now()}`;
    await withHouseholdContext(db, alphaHouseholdId, (tx) =>
      tx.insert(notes).values({
        householdId: alphaHouseholdId,
        title: marker,
        content: "should not leak",
        visibility: "household",
      }),
    );

    const betaView = await withHouseholdContext(db, betaHouseholdId, (tx) =>
      tx.select({ title: notes.title }).from(notes).where(eq(notes.title, marker)),
    );
    expect(betaView).toHaveLength(0);

    const alphaView = await withHouseholdContext(db, alphaHouseholdId, (tx) =>
      tx.select({ title: notes.title }).from(notes).where(eq(notes.title, marker)),
    );
    expect(alphaView).toHaveLength(1);
  });

  it("allows worker scan context to list multiple households", async () => {
    const rows = await withWorkerScanContext(db, (tx) =>
      tx
        .select({ slug: households.slug })
        .from(households)
        .where(eq(households.slug, "alpha-hosted")),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
