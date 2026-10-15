import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { decryptSensitive } from "@domi-ops/crypto";
import {
  closeDb,
  createDb,
  healthChecks,
  healthEvents,
  healthExerciseDetails,
  healthVitalsReadings,
  healthWithingsLinks,
  healthWithingsMeasureGroups,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { loadCheckSlotStatuses } from "./health-check-status.js";
import {
  encryptWithingsSecret,
  fanOutWithingsSync,
  processWithingsLink,
  syncWithingsHousehold,
} from "./withings-sync.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const KEY = "test-health-encryption-key-32chars!!";
const env = { ENCRYPTION_KEY: KEY, WITHINGS_CLIENT_ID: "client", WITHINGS_CLIENT_SECRET: "secret" } as Env;

type FetchCall = { url: string; form: URLSearchParams; auth: string | null };

/** A fake Withings: measure pages come from `pages` in order, token requests from `token`. */
function fakeWithings(opts: {
  pages?: Array<Record<string, unknown>>;
  /** Pages of `getworkouts`, in order. */
  workouts?: Array<Record<string, unknown>>;
  measureStatus?: number;
  token?: Record<string, unknown>;
  tokenStatus?: number;
}) {
  const calls: FetchCall[] = [];
  let page = 0;
  let workoutPage = 0;
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, form, auth: new Headers(init?.headers).get("authorization") });
    if (url.includes("/v2/oauth2")) {
      return new Response(JSON.stringify({ status: opts.tokenStatus ?? 0, body: opts.token ?? {} }), { status: 200 });
    }
    if (url.includes("/v2/measure")) {
      const body = opts.workouts?.[Math.min(workoutPage, opts.workouts.length - 1)] ?? { series: [], more: 0, offset: 0 };
      workoutPage += 1;
      return new Response(JSON.stringify({ status: 0, body }), { status: 200 });
    }
    if (url.includes("/measure")) {
      if (opts.measureStatus && opts.measureStatus >= 500) return new Response("{}", { status: opts.measureStatus });
      const body = opts.pages?.[Math.min(page, (opts.pages?.length ?? 1) - 1)] ?? { measuregrps: [], more: 0, updatetime: 1 };
      page += 1;
      return new Response(JSON.stringify({ status: 0, body }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 0, body: {} }), { status: 200 });
  });
  return {
    impl,
    calls,
    measureCalls: () => calls.filter((c) => c.url.includes("/measure") && !c.url.includes("/v2/")),
    workoutCalls: () => calls.filter((c) => c.url.includes("/v2/measure")),
  };
}

const grp = (grpid: number, iso: string, sys = 128, dia = 82, pulse = 64, extra: Record<string, unknown> = {}) => ({
  grpid,
  date: Math.floor(new Date(iso).getTime() / 1000),
  measures: [
    { value: sys, type: 10, unit: 0 },
    { value: dia, type: 9, unit: 0 },
    { value: pulse, type: 11, unit: 0 },
  ],
  ...extra,
});

/**
 * WHO-452: the Withings sync against a real Postgres, as the RLS-enforced app role, with an injected
 * clock and a fake Withings. Every state-changing call runs in the household's own context, exactly
 * like the worker's household job.
 */
maybeDescribe("Withings sync (integration)", () => {
  let db: Database;
  let householdId: string;
  let otherHouseholdId: string;
  let memberId: string;
  let userId: string;
  let otherMemberId: string;

  const NOW = new Date("2026-10-13T15:00:00.000Z");

  async function seedHousehold(name: string) {
    return withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "America/Chicago", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      const [u] = await tx
        .insert(users)
        .values({ email: `withings-${randomUUID()}@test.local`, displayName: name, emailVerified: true })
        .returning({ id: users.id });
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId: hh!.id, userId: u!.id, role: "member", name })
        .returning({ id: householdMembers.id });
      return { householdId: hh!.id, userId: u!.id, memberId: m!.id };
    });
  }

  async function makeLink(over: Partial<typeof healthWithingsLinks.$inferInsert> = {}, target = { householdId, memberId, userId }) {
    const [row] = await withHouseholdContext(db, target.householdId, (tx) =>
      tx
        .insert(healthWithingsLinks)
        .values({
          householdId: target.householdId,
          memberId: target.memberId,
          withingsUserId: "9001",
          accessTokenEncrypted: encryptWithingsSecret("access-1", env),
          refreshTokenEncrypted: encryptWithingsSecret("refresh-1", env),
          tokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
          linkedByUserId: target.userId,
          backfillFrom: new Date("2026-01-01T00:00:00.000Z"),
          syncRequestedAt: new Date(NOW.getTime() - 1000),
          ...over,
        })
        .returning(),
    );
    return row!;
  }

  // The base database, not a transaction: the sync opens its own short household-scoped ones, exactly
  // as the worker's household job does.
  const run = (linkId: string, fetchImpl: ReturnType<typeof fakeWithings>["impl"], now = NOW) =>
    processWithingsLink(db, env, { householdId, linkId }, now, fetchImpl);

  const groupRows = () =>
    withHouseholdContext(db, householdId, (tx) =>
      tx.select().from(healthWithingsMeasureGroups).where(eq(healthWithingsMeasureGroups.memberId, memberId)),
    );

  const reload = (linkId: string) =>
    withHouseholdContext(db, householdId, async (tx) => {
      const [row] = await tx.select().from(healthWithingsLinks).where(eq(healthWithingsLinks.id, linkId));
      return row!;
    });

  const vitalsEvents = () =>
    withHouseholdContext(db, householdId, (tx) =>
      tx.select().from(healthEvents).where(and(eq(healthEvents.householdId, householdId), eq(healthEvents.type, "vitals"))),
    );

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    ({ householdId, memberId, userId } = await seedHousehold("withings-it"));
    ({ householdId: otherHouseholdId, memberId: otherMemberId } = await seedHousehold("withings-it-other"));
  }, 30_000);

  beforeEach(async () => {
    if (!db) return;
    await withHouseholdContext(db, householdId, async (tx) => {
      // The dedupe rows belong to the person, not the link, so deleting links does not clear them.
      await tx.delete(healthWithingsMeasureGroups).where(eq(healthWithingsMeasureGroups.householdId, householdId));
      await tx.delete(healthWithingsLinks).where(eq(healthWithingsLinks.householdId, householdId));
      await tx.delete(healthChecks).where(eq(healthChecks.householdId, householdId));
      await tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId));
    });
    await withHouseholdContext(db, otherHouseholdId, (tx) =>
      tx.delete(healthWithingsLinks).where(eq(healthWithingsLinks.householdId, otherHouseholdId)),
    );
  });

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      await tx.delete(households).where(inArray(households.id, [householdId, otherHouseholdId]));
    });
    await closeDb(db);
  });

  describe("backfill and import", () => {
    it("pages through history, imports each group once as an encrypted vitals entry, and sets the watermark", async () => {
      const link = await makeLink();
      const fw = fakeWithings({
        pages: [
          { measuregrps: [grp(1, "2026-09-01T13:00:00Z"), grp(2, "2026-09-02T13:00:00Z", 140, 90, 70)], more: 1, offset: 2, updatetime: 1_790_000_000 },
          { measuregrps: [grp(3, "2026-09-03T13:00:00Z", 118, 76, 58)], more: 0, offset: 0, updatetime: 1_790_000_005 },
        ],
      });

      expect(await run(link.id, fw.impl)).toBe("synced");

      const events = await vitalsEvents();
      expect(events).toHaveLength(3);
      // History lands at the time it was measured, not at the time it was imported.
      expect(events.map((e) => e.startedAt?.toISOString()).sort()).toEqual([
        "2026-09-01T13:00:00.000Z",
        "2026-09-02T13:00:00.000Z",
        "2026-09-03T13:00:00.000Z",
      ]);
      const first = events.find((e) => e.startedAt?.toISOString() === "2026-09-02T13:00:00.000Z")!;
      expect(first.title.startsWith("enc:v1:")).toBe(true);
      expect(decryptSensitive(first.title, KEY)).toBe("Blood pressure");
      expect(first.memberId).toBe(memberId);
      expect(first.createdByUserId).toBe(userId);

      const readings = await withHouseholdContext(db, householdId, (tx) =>
        tx.select().from(healthVitalsReadings).where(eq(healthVitalsReadings.eventId, first.id)),
      );
      const byMetric = Object.fromEntries(readings.map((r) => [r.metric, [decryptSensitive(r.value, KEY), r.unit]]));
      expect(byMetric).toEqual({
        blood_pressure_systolic: ["140", "mmHg"],
        blood_pressure_diastolic: ["90", "mmHg"],
        heart_rate: ["70", "bpm"],
      });

      // The second page was asked for with the offset Withings returned, over the history window.
      const [p1, p2] = fw.measureCalls();
      expect(p1!.form.get("startdate")).toBe(String(Math.floor(link.backfillFrom.getTime() / 1000)));
      expect(p1!.form.get("enddate")).toBe(String(Math.floor(NOW.getTime() / 1000)));
      expect(p1!.form.get("meastypes")).toBe("9,10,11,54,71");
      expect(p1!.form.get("offset")).toBeNull();
      expect(p2!.form.get("offset")).toBe("2");
      expect(p1!.auth).toBe("Bearer access-1");

      const after = await reload(link.id);
      expect(after.backfillDoneAt).not.toBeNull();
      // The watermark is the first page's updatetime, so anything that lands mid-backfill is caught next time.
      expect(after.lastUpdate).toBe(1_790_000_000);
      expect(after.lastSyncedAt?.toISOString()).toBe(NOW.toISOString());
      expect(after.syncRequestedAt).toBeNull();
      expect(after.attempts).toBe(0);
    });

    it("asks only for what changed once the backfill is done, and importing the same group twice makes one entry", async () => {
      const link = await makeLink();
      const first = fakeWithings({ pages: [{ measuregrps: [grp(1, "2026-09-01T13:00:00Z")], more: 0, updatetime: 1_790_000_000 }] });
      await run(link.id, first.impl);

      // A re-delivered group, plus a new one.
      const second = fakeWithings({
        pages: [{ measuregrps: [grp(1, "2026-09-01T13:00:00Z"), grp(2, "2026-10-13T14:00:00Z")], more: 0, updatetime: 1_790_000_100 }],
      });
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthWithingsLinks).set({ syncRequestedAt: new Date(NOW.getTime() - 1) }).where(eq(healthWithingsLinks.id, link.id)),
      );
      await run(link.id, second.impl, new Date(NOW.getTime() + 60_000));

      const call = second.measureCalls()[0]!;
      expect(call.form.get("lastupdate")).toBe("1790000000");
      expect(call.form.get("startdate")).toBeNull();
      expect(await vitalsEvents()).toHaveLength(2);
      expect((await reload(link.id)).lastUpdate).toBe(1_790_000_100);
    });

    it("ignores groups with nothing it keeps (a weight on its own)", async () => {
      const link = await makeLink();
      const fw = fakeWithings({
        pages: [
          {
            measuregrps: [{ grpid: 7, date: 1_790_000_000, measures: [{ value: 70_000, type: 1, unit: -3 }] }, grp(8, "2026-09-01T13:00:00Z")],
            more: 0,
            updatetime: 1,
          },
        ],
      });
      await run(link.id, fw.impl);
      expect(await vitalsEvents()).toHaveLength(1);
    });

    it("imports watch readings (SpO2, temperature, a lone pulse) as vitals entries", async () => {
      const link = await makeLink();
      const fw = fakeWithings({
        pages: [
          {
            measuregrps: [
              { grpid: 30, date: 1_790_000_000, measures: [{ value: 97, type: 54, unit: 0 }] },
              { grpid: 31, date: 1_790_000_100, measures: [{ value: 3700, type: 71, unit: -2 }] },
              { grpid: 32, date: 1_790_000_200, measures: [{ value: 58, type: 11, unit: 0 }] },
            ],
            more: 0,
            updatetime: 1,
          },
        ],
      });
      await run(link.id, fw.impl);
      const events = await vitalsEvents();
      expect(events).toHaveLength(3);
      const readings = await withHouseholdContext(db, householdId, (tx) =>
        tx.select().from(healthVitalsReadings).where(inArray(healthVitalsReadings.eventId, events.map((e) => e.id))),
      );
      const byMetric = Object.fromEntries(readings.map((r) => [r.metric, `${decryptSensitive(r.value, KEY)} ${r.unit}`]));
      expect(byMetric).toEqual({ blood_oxygen: "97 %", temperature: "98.6 °F", heart_rate: "58 bpm" });
      expect(fw.measureCalls()[0]!.form.get("meastypes")).toBe("9,10,11,54,71");
    });

    it("does not bring back an entry the user deleted, even on a fresh backfill", async () => {
      const link = await makeLink();
      const pages = [{ measuregrps: [grp(1, "2026-09-01T13:00:00Z")], more: 0, updatetime: 1_790_000_000 }];
      await run(link.id, fakeWithings({ pages }).impl);

      await withHouseholdContext(db, householdId, (tx) => tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId)));
      const tombstone = await groupRows();
      expect(tombstone).toHaveLength(1);
      expect(tombstone[0]!.eventId).toBeNull();

      await withHouseholdContext(db, householdId, (tx) =>
        tx
          .update(healthWithingsLinks)
          .set({ backfillDoneAt: null, lastUpdate: null, syncRequestedAt: new Date(NOW.getTime() - 1), nextAttemptAt: null })
          .where(eq(healthWithingsLinks.id, link.id)),
      );
      await run(link.id, fakeWithings({ pages }).impl, new Date(NOW.getTime() + 60_000));
      expect(await vitalsEvents()).toHaveLength(0);
    });

    it("reconnecting the same Withings account after an unlink imports nothing twice and keeps deleted readings deleted", async () => {
      const link = await makeLink();
      const pages = [
        { measuregrps: [grp(1, "2026-09-01T13:00:00Z"), grp(2, "2026-09-02T13:00:00Z")], more: 0, updatetime: 10 },
      ];
      await run(link.id, fakeWithings({ pages }).impl);
      expect(await vitalsEvents()).toHaveLength(2);

      // The person deletes one entry by hand, then unlinks (what a revoked link tells them to do).
      const events = await vitalsEvents();
      const sept1 = events.find((e) => e.startedAt?.toISOString() === "2026-09-01T13:00:00.000Z")!;
      await withHouseholdContext(db, householdId, async (tx) => {
        await tx.delete(healthEvents).where(eq(healthEvents.id, sept1.id));
        await tx.delete(healthWithingsLinks).where(eq(healthWithingsLinks.id, link.id));
      });
      expect(await groupRows()).toHaveLength(2);

      // Connect again: a new link and a fresh backfill over the same history.
      const again = await makeLink();
      await run(again.id, fakeWithings({ pages }).impl, new Date(NOW.getTime() + 60_000));

      const after = await vitalsEvents();
      expect(after).toHaveLength(1);
      expect(after[0]!.startedAt?.toISOString()).toBe("2026-09-02T13:00:00.000Z");
      expect(await groupRows()).toHaveLength(2);
    });

    it("leaves out readings Withings could not attribute to this person, and imports them once they are", async () => {
      const link = await makeLink();
      const fw = fakeWithings({
        pages: [
          {
            measuregrps: [
              grp(1, "2026-09-01T13:00:00Z", 128, 82, 64, { attrib: 1 }), // ambiguous: could be anyone on the cuff
              grp(2, "2026-09-02T13:00:00Z", 128, 82, 64, { attrib: 4 }), // typed in during user creation
              grp(3, "2026-09-03T13:00:00Z", 128, 82, 64, { attrib: 0 }),
              grp(4, "2026-09-04T13:00:00Z", 128, 82, 64, { attrib: 2 }),
              grp(5, "2026-09-05T13:00:00Z", 128, 82, 64, { attrib: 5 }),
            ],
            more: 0,
            updatetime: 10,
          },
        ],
      });
      await run(link.id, fw.impl);

      expect((await vitalsEvents()).map((e) => e.startedAt?.toISOString()).sort()).toEqual([
        "2026-09-03T13:00:00.000Z",
        "2026-09-04T13:00:00.000Z",
        "2026-09-05T13:00:00.000Z",
      ]);
      // No row for what was skipped, so it is looked at again if it changes.
      expect((await groupRows()).map((r) => r.grpid).sort()).toEqual(["3", "4", "5"]);

      // The person assigns the first reading to themselves in the Withings app: it comes back changed.
      await withHouseholdContext(db, householdId, (tx) =>
        tx
          .update(healthWithingsLinks)
          .set({ syncRequestedAt: new Date(NOW.getTime() - 1), nextAttemptAt: null })
          .where(eq(healthWithingsLinks.id, link.id)),
      );
      await run(
        link.id,
        fakeWithings({ pages: [{ measuregrps: [grp(1, "2026-09-01T13:00:00Z", 128, 82, 64, { attrib: 0 })], more: 0, updatetime: 11 }] }).impl,
        new Date(NOW.getTime() + 60_000),
      );
      expect(await vitalsEvents()).toHaveLength(4);
    });

    it("pulls each page with no transaction open, so a failure keeps the pages already imported", async () => {
      const link = await makeLink();
      let page = 0;
      const impl = vi.fn(async (url: string) => {
        if (!url.includes("/measure")) return new Response(JSON.stringify({ status: 0, body: {} }), { status: 200 });
        page += 1;
        if (page === 1) {
          const body = { measuregrps: [grp(1, "2026-09-01T13:00:00Z")], more: 1, offset: 1, updatetime: 10 };
          return new Response(JSON.stringify({ status: 0, body }), { status: 200 });
        }
        return new Response("{}", { status: 503 });
      });
      expect(await run(link.id, impl)).toBe("failed");

      // Page one stays, but the watermark did not move, so the next run starts over (and skips it).
      expect(await vitalsEvents()).toHaveLength(1);
      const after = await reload(link.id);
      expect(after.backfillDoneAt).toBeNull();
      expect(after.attempts).toBe(1);
    });
  });

  describe("workouts", () => {
    const run1 = (over: Record<string, unknown> = {}) => ({
      id: 5001,
      category: 2,
      startdate: 1_790_000_000,
      enddate: 1_790_001_800,
      data: { distance: 5230, calories: 311.6 },
      ...over,
    });

    const exerciseRows = () =>
      withHouseholdContext(db, householdId, async (tx) => {
        const events = await tx
          .select()
          .from(healthEvents)
          .where(and(eq(healthEvents.householdId, householdId), eq(healthEvents.type, "exercise")));
        const details = events.length
          ? await tx.select().from(healthExerciseDetails).where(inArray(healthExerciseDetails.eventId, events.map((e) => e.id)))
          : [];
        return { events, details };
      });

    it("imports a workout as an exercise entry, once, with Withings as its source", async () => {
      const link = await makeLink({ scope: "user.metrics,user.activity" });
      const fw = fakeWithings({ pages: [{ measuregrps: [], more: 0, updatetime: 1_790_000_000 }], workouts: [{ series: [run1()], more: 0, offset: 0 }] });
      await run(link.id, fw.impl);

      const { events, details } = await exerciseRows();
      expect(events).toHaveLength(1);
      expect(decryptSensitive(events[0]!.title, KEY)).toBe("Running");
      expect(events[0]!.endedAt?.toISOString()).toBe(new Date(1_790_001_800 * 1000).toISOString());
      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({ externalSource: "withings", externalId: "5001", distanceUnit: "km" });
      expect(decryptSensitive(details[0]!.durationMinutes!, KEY)).toBe("30");
      expect(decryptSensitive(details[0]!.distance!, KEY)).toBe("5.23");
      expect(decryptSensitive(details[0]!.caloriesEstimated!, KEY)).toBe("312");

      // Backfill asks by date; a repeat of the same workout changes nothing.
      expect(fw.workoutCalls()[0]!.form.get("startdateymd")).toBe("2025-12-31");
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthWithingsLinks).set({ syncRequestedAt: new Date(NOW.getTime() - 1) }).where(eq(healthWithingsLinks.id, link.id)),
      );
      const again = fakeWithings({ pages: [{ measuregrps: [], more: 0, updatetime: 1_790_000_100 }], workouts: [{ series: [run1()], more: 0, offset: 0 }] });
      await run(link.id, again.impl, new Date(NOW.getTime() + 60_000));
      expect((await exerciseRows()).events).toHaveLength(1);
      expect(again.workoutCalls()[0]!.form.get("lastupdate")).toBe(String(1_790_000_000 - 86_400));
    });

    it("resumes workouts from the newest workout's own modified time, not the measurement clock", async () => {
      const link = await makeLink({ scope: "user.metrics,user.activity" });
      const first = fakeWithings({
        pages: [{ measuregrps: [], more: 0, updatetime: 1_790_000_000 }],
        workouts: [{ series: [run1({ modified: 1_790_500_000 }), run1({ id: 5002, modified: 1_790_400_000 })], more: 0, offset: 0 }],
      });
      await run(link.id, first.impl);
      const stored = await withHouseholdContext(db, householdId, (tx) =>
        tx.select().from(healthWithingsLinks).where(eq(healthWithingsLinks.id, link.id)),
      );
      expect(stored[0]!.workoutsLastUpdate).toBe(1_790_500_000);

      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthWithingsLinks).set({ syncRequestedAt: new Date(NOW.getTime() - 1) }).where(eq(healthWithingsLinks.id, link.id)),
      );
      // getmeas' clock is a month ahead of the workout clock; the workout pull must not care.
      const again = fakeWithings({ pages: [{ measuregrps: [], more: 0, updatetime: 1_793_000_000 }], workouts: [{ series: [], more: 0, offset: 0 }] });
      await run(link.id, again.impl, new Date(NOW.getTime() + 60_000));
      expect(again.workoutCalls()[0]!.form.get("lastupdate")).toBe(String(1_790_500_000 - 1));
      const kept = await withHouseholdContext(db, householdId, (tx) =>
        tx.select().from(healthWithingsLinks).where(eq(healthWithingsLinks.id, link.id)),
      );
      expect(kept[0]!.workoutsLastUpdate).toBe(1_790_500_000);
    });

    it("does not bring back a workout the user deleted", async () => {
      const link = await makeLink({ scope: "user.metrics,user.activity" });
      const fw = () => fakeWithings({ pages: [{ measuregrps: [], more: 0, updatetime: 1 }], workouts: [{ series: [run1()], more: 0, offset: 0 }] });
      await run(link.id, fw().impl);
      const { events } = await exerciseRows();
      await withHouseholdContext(db, householdId, (tx) => tx.delete(healthEvents).where(eq(healthEvents.id, events[0]!.id)));
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthWithingsLinks).set({ syncRequestedAt: new Date(NOW.getTime() - 1), backfillDoneAt: null, lastUpdate: null }).where(eq(healthWithingsLinks.id, link.id)),
      );
      await run(link.id, fw().impl, new Date(NOW.getTime() + 60_000));
      expect((await exerciseRows()).events).toHaveLength(0);
    });

    it("never asks Withings for workouts on a link without the activity scope", async () => {
      const link = await makeLink({ scope: "user.metrics" });
      const fw = fakeWithings({ pages: [{ measuregrps: [], more: 0, updatetime: 1 }], workouts: [{ series: [run1()], more: 0, offset: 0 }] });
      await run(link.id, fw.impl);
      expect(fw.workoutCalls()).toHaveLength(0);
      expect((await exerciseRows()).events).toHaveLength(0);
    });
  });

  describe("scheduled checks", () => {
    it("an imported reading inside the tolerance window answers the slot, one outside does not", async () => {
      const link = await makeLink();
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthChecks).values({
          householdId,
          memberId,
          name: "BP",
          eventType: "vitals",
          templateJson: JSON.stringify({ metrics: ["blood_pressure_systolic", "blood_pressure_diastolic"] }),
          scheduleJson: JSON.stringify({ times: ["12:05", "20:00"] }),
          startDate: "2026-09-01",
        }),
      );
      // 12:05 CDT is 17:05Z. 17:03Z is two minutes early; 22:30Z (17:30 CDT) is nowhere near 20:00 CDT.
      await run(
        link.id,
        fakeWithings({
          pages: [{ measuregrps: [grp(1, "2026-10-02T17:03:00Z"), grp(2, "2026-10-02T22:30:00Z")], more: 0, updatetime: 5 }],
        }).impl,
      );

      const checks = await withHouseholdContext(db, householdId, (tx) => tx.select().from(healthChecks).where(eq(healthChecks.householdId, householdId)));
      const statuses = await withHouseholdContext(db, householdId, (tx) =>
        loadCheckSlotStatuses(tx, env, {
          checks,
          from: "2026-10-02",
          to: "2026-10-02",
          timeZone: "America/Chicago",
          now: new Date("2026-10-03T12:00:00Z"),
        }),
      );
      const slots = statuses.get(checks[0]!.id)!;
      const at = (iso: string) => slots.find((s) => s.scheduledAt.toISOString() === iso)!;
      expect(at("2026-10-02T17:05:00.000Z").status).toBe("done");
      // 22:30Z is 17:30 CDT: 2.5 hours from the 20:00 slot, so that slot stays unanswered.
      expect(["overdue", "missed"]).toContain(at("2026-10-03T01:00:00.000Z").status);
    });
  });

  describe("tokens and failures", () => {
    it("refreshes an expiring token, stores the rotated pair, and pulls with the new access token", async () => {
      const link = await makeLink({ tokenExpiresAt: new Date(NOW.getTime() + 60_000) });
      const fw = fakeWithings({
        token: { userid: 9001, access_token: "access-2", refresh_token: "refresh-2", expires_in: 10800 },
        pages: [{ measuregrps: [], more: 0, updatetime: 5 }],
      });
      expect(await run(link.id, fw.impl)).toBe("synced");

      const refresh = fw.calls.find((c) => c.url.includes("/v2/oauth2"))!;
      expect(refresh.form.get("grant_type")).toBe("refresh_token");
      expect(refresh.form.get("refresh_token")).toBe("refresh-1");
      expect(fw.measureCalls()[0]!.auth).toBe("Bearer access-2");

      const after = await reload(link.id);
      expect(decryptSensitive(after.accessTokenEncrypted, KEY)).toBe("access-2");
      expect(decryptSensitive(after.refreshTokenEncrypted, KEY)).toBe("refresh-2");
      expect(after.tokenExpiresAt.getTime()).toBe(NOW.getTime() + 10800 * 1000);
    });

    it("keeps the rotated refresh token even when the pull that follows fails", async () => {
      const link = await makeLink({ tokenExpiresAt: new Date(NOW.getTime() - 1000) });
      const fw = fakeWithings({
        token: { userid: 9001, access_token: "access-2", refresh_token: "refresh-2", expires_in: 10800 },
        measureStatus: 503,
      });
      expect(await run(link.id, fw.impl)).toBe("failed");

      const after = await reload(link.id);
      // Withings has already retired refresh-1. Losing refresh-2 here would strand the link.
      expect(decryptSensitive(after.refreshTokenEncrypted, KEY)).toBe("refresh-2");
      expect(after.status).toBe("active");
      expect(after.attempts).toBe(1);
      expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(NOW.getTime());
      expect(after.backfillDoneAt).toBeNull();
    });

    it("marks the link revoked when Withings rejects the token, and stops retrying", async () => {
      const link = await makeLink({ tokenExpiresAt: new Date(NOW.getTime() - 1000) });
      const fw = fakeWithings({ tokenStatus: 401 });
      expect(await run(link.id, fw.impl)).toBe("failed");

      const after = await reload(link.id);
      expect(after.status).toBe("revoked");
      expect(after.syncRequestedAt).toBeNull();
      expect(after.lastError).toContain("token_invalid");

      // Revoked links are not due, so another pass does nothing.
      expect(await run(link.id, fw.impl)).toBe("skipped");
    });

    it("skips a link someone else is already syncing", async () => {
      const link = await makeLink({ nextAttemptAt: new Date(NOW.getTime() + 5 * 60 * 1000) });
      const fw = fakeWithings({});
      expect(await run(link.id, fw.impl)).toBe("skipped");
      expect(fw.impl).not.toHaveBeenCalled();
    });
  });

  describe("scheduling", () => {
    it("syncs a household's due links, and leaves ones that are not due alone", async () => {
      const due = await makeLink();
      const fw = fakeWithings({
        pages: [{ measuregrps: [], more: 0, updatetime: 1 }],
        // Seven hours on, the three-hour access token has lapsed, so the safety-net pull refreshes first.
        token: { userid: 9001, access_token: "access-2", refresh_token: "refresh-2", expires_in: 10800 },
      });
      const tally = await syncWithingsHousehold(db, env, { householdId, now: NOW, fetchImpl: fw.impl });
      expect(tally).toEqual({ synced: 1, skipped: 0, failed: 0 });

      // Just synced, no webhook since: nothing to do until the safety net.
      const again = await syncWithingsHousehold(db, env, { householdId, now: new Date(NOW.getTime() + 60_000), fetchImpl: fw.impl });
      expect(again).toEqual({ synced: 0, skipped: 0, failed: 0 });

      // ...and past the safety net it pulls again without being told to.
      const later = await syncWithingsHousehold(db, env, { householdId, now: new Date(NOW.getTime() + 7 * 60 * 60 * 1000), fetchImpl: fw.impl });
      expect(later.synced).toBe(1);
      expect(due.id).toBeTruthy();
    });

    it("the tick names only households with a due link", async () => {
      await makeLink();
      // The other household has a link that was just synced and is not flagged.
      await makeLink(
        { syncRequestedAt: null, lastSyncedAt: new Date(NOW.getTime() - 60_000), backfillDoneAt: NOW, lastUpdate: 1 },
        { householdId: otherHouseholdId, memberId: otherMemberId, userId },
      );

      const enqueue = vi.fn(async () => {});
      await withWorkerScanContext(db, (tx) => fanOutWithingsSync(tx, env, { enqueue, now: NOW }));
      const named = (enqueue.mock.calls as unknown as Array<[string, string, string]>)
        .filter(([, id]) => id === householdId || id === otherHouseholdId)
        .map(([job, id]) => [job, id]);
      expect(named).toEqual([["withings.sync.household", householdId]]);
    });

    it("does nothing at all on a deployment with no Withings credentials", async () => {
      await makeLink();
      const enqueue = vi.fn(async () => {});
      expect(await withWorkerScanContext(db, (tx) => fanOutWithingsSync(tx, {}, { enqueue, now: NOW }))).toBe(0);
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("tenant isolation", () => {
    it("another household cannot see or change a link, or the groups it has imported", async () => {
      const link = await makeLink();
      await run(link.id, fakeWithings({ pages: [{ measuregrps: [grp(1, "2026-09-01T13:00:00Z")], more: 0, updatetime: 1 }] }).impl);

      await withHouseholdContext(db, otherHouseholdId, async (tx) => {
        expect(await tx.select().from(healthWithingsLinks).where(eq(healthWithingsLinks.id, link.id))).toHaveLength(0);
        expect(await tx.select().from(healthWithingsMeasureGroups).where(eq(healthWithingsMeasureGroups.memberId, memberId))).toHaveLength(0);
        const touched = await tx
          .update(healthWithingsLinks)
          .set({ status: "revoked" })
          .where(eq(healthWithingsLinks.id, link.id))
          .returning({ id: healthWithingsLinks.id });
        expect(touched).toHaveLength(0);
      });
      // Its own transaction: a rejected write aborts the one it ran in.
      // Drizzle wraps the driver's message, so the policy violation is on the cause.
      const forged = await withHouseholdContext(db, otherHouseholdId, (tx) =>
        tx.insert(healthWithingsMeasureGroups).values({ householdId, memberId, withingsUserId: "forged", grpid: "forged", eventId: null }),
      ).then(
        () => null,
        (e: Error & { cause?: Error }) => e,
      );
      expect(forged).not.toBeNull();
      expect(`${forged!.message} ${forged!.cause?.message ?? ""}`).toMatch(/row-level security/);
      expect((await reload(link.id)).status).toBe("active");
    });

    it("a worker scan can read links to find the due ones, but cannot write them or read the imported groups", async () => {
      const link = await makeLink();
      await run(link.id, fakeWithings({ pages: [{ measuregrps: [grp(1, "2026-09-01T13:00:00Z")], more: 0, updatetime: 1 }] }).impl);

      await withWorkerScanContext(db, async (tx) => {
        expect((await tx.select({ id: healthWithingsLinks.id }).from(healthWithingsLinks).where(eq(healthWithingsLinks.id, link.id))).length).toBe(1);
        const touched = await tx
          .update(healthWithingsLinks)
          .set({ status: "revoked" })
          .where(eq(healthWithingsLinks.id, link.id))
          .returning({ id: healthWithingsLinks.id });
        expect(touched).toHaveLength(0);
        expect(await tx.select().from(healthWithingsMeasureGroups).where(eq(healthWithingsMeasureGroups.memberId, memberId))).toHaveLength(0);
      });
      expect((await reload(link.id)).status).toBe("active");
    });

    it("does not leak tokens into a link's plain columns", async () => {
      const link = await makeLink();
      expect(link.accessTokenEncrypted.startsWith("enc:v1:")).toBe(true);
      expect(link.refreshTokenEncrypted.startsWith("enc:v1:")).toBe(true);
      expect(JSON.stringify({ ...link, accessTokenEncrypted: "", refreshTokenEncrypted: "" })).not.toMatch(/access-1|refresh-1/);
    });
  });
});
