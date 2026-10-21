import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { calendarConnections, calendarEvents, calendarSyncOutbox, calendars, closeDb, createDb, createScopedDb, households, linkedGoogleCalendars, users, withHouseholdContext, withSystemContext, type Database } from "@domi-ops/db";
import { runCalendarSyncJob, pullLinkedCalendar, processOutboxForConnection } from "@domi-ops/calendar-sync";
import { calendarRoutes } from "./calendar.js";
import { markSyncQueued, buildCalendarSyncStatus } from "../lib/calendar-sync-status.js";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";

const state = vi.hoisted(() => ({ enqueue: vi.fn(), pullItems: [] as Record<string, unknown>[] }));
vi.mock("@domi-ops/calendar-sync", async original => ({ ...await original<typeof import("@domi-ops/calendar-sync")>(), enqueueSyncJob: state.enqueue }));
vi.mock("../../../../packages/calendar-sync/dist/client.js", async original => ({
  ...await original<typeof import("../../../../packages/calendar-sync/dist/client.js")>(),
  ensureAccessToken: vi.fn(async () => "synthetic-access-token"),
  googleCalendarFetch: vi.fn(async () => ({ items: state.pullItems })),
}));

const URL = process.env.HOSTED_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
suite("durable Google deletion with hosted tenant restrictions", () => {
  let db: Database;
  let app: Hono<{ Variables: AppVariables }>;
  const fixtures: { householdId: string; userId: string; calendarId: string; connectionId: string; linkedId: string }[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;
  const env = { NODE_ENV: "test", AUTH_REQUIRED: true, DEPLOYMENT_MODE: "single", MODULES_ENABLED: ["calendar_sync"], REDIS_URL: "redis://unused" } as Env;
  const inTenant = <T>(index: number, fn: (tx: Database) => Promise<T>) => withHouseholdContext(db, fixtures[index].householdId, fn);
  const request = async (index: number, path: string, method: string, body?: unknown) => app.request(path, {
    method, headers: { "content-type": "application/json", "x-fixture": String(index) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const create = async (index = 0) => {
    const response = await request(index, "/events", "POST", { calendarId: fixtures[index].calendarId, title: "Synthetic demo", startDate: "2026-10-20", startTime: "20:00", endTime: "21:00", timeZone: "America/Chicago", allDay: false });
    expect(response.status).toBe(201);
    return (await response.json() as { event: { id: string } }).event.id;
  };
  const drain = (index = 0) => inTenant(index, tx => runCalendarSyncJob(tx, env, "google.calendar.push", { householdId: fixtures[index].householdId, connectionId: fixtures[index].connectionId }));
  const outbox = (index = 0) => inTenant(index, tx => tx.select().from(calendarSyncOutbox));

  beforeAll(async () => {
    db = createDb(URL!);
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);
    expect(role.rolsuper || role.rolbypassrls).toBe(false);
    for (let i = 0; i < 2; i++) {
      const identity = await withSystemContext(db, async tx => {
        const [household] = await tx.insert(households).values({ name: `calendar-delete-${randomUUID()}`, modulesEnabled: '["calendar_sync"]' }).returning();
        const [user] = await tx.insert(users).values({ email: `calendar-delete-${randomUUID()}@example.test` }).returning();
        return { householdId: household.id, userId: user.id };
      });
      const rest = await withHouseholdContext(db, identity.householdId, async tx => {
        const [calendar] = await tx.insert(calendars).values({ householdId: identity.householdId, ownerUserId: identity.userId, name: "Synthetic Google lane", visibility: "private" }).returning();
        const [connection] = await tx.insert(calendarConnections).values({ ...identity, refreshTokenEnc: "fixture", syncMode: "bidirectional" }).returning();
        const [linked] = await tx.insert(linkedGoogleCalendars).values({ connectionId: connection.id, googleCalendarId: `synthetic-${i}`, targetCalendarId: calendar.id }).returning();
        return { calendarId: calendar.id, connectionId: connection.id, linkedId: linked.id };
      });
      fixtures.push({ ...identity, ...rest });
    }
    const scoped = createScopedDb(db);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("auth", { ...fixtures[Number(c.req.header("x-fixture")) || 0], memberId: randomUUID(), role: "owner", email: null, username: null, name: "Synthetic tester" });
      await next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/", calendarRoutes(scoped, env));
  });
  beforeEach(async () => {
    state.pullItems = [];
    state.enqueue.mockReset();
    fetchMock = vi.fn(async (url: string, init: RequestInit) => init.method === "DELETE"
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ id: JSON.parse(String(init.body)).id ?? decodeURIComponent(url.split("/").pop()!), etag: "etag" })));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < fixtures.length; i++) await inTenant(i, async tx => {
      await tx.delete(calendarSyncOutbox);
      await tx.delete(calendarEvents);
      await tx.update(calendarConnections).set({ syncMode: "bidirectional", syncRunStatus: "idle", syncRunError: null });
      await tx.update(linkedGoogleCalendars).set({ syncEnabled: true, googleCalendarId: `synthetic-${i}` });
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async tx => {
      if (fixtures.length) await tx.delete(households).where(inArray(households.id, fixtures.map(f => f.householdId)));
      if (fixtures.length) await tx.delete(users).where(inArray(users.id, fixtures.map(f => f.userId)));
    });
    await closeDb(db);
  });

  it("runs create, edit and delete while retaining deletion across a new worker DB connection", async () => {
    const id = await create();
    await drain();
    expect((await request(0, `/events/${id}`, "PATCH", { title: "Updated synthetic demo" })).status).toBe(200);
    await drain();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT", body: expect.stringContaining("Updated synthetic demo") });
    expect((await request(0, `/events/${id}`, "DELETE")).status).toBe(200);
    const [intent] = await outbox();
    expect(intent).toMatchObject({ eventId: null, operation: "delete", householdId: fixtures[0].householdId, connectionId: fixtures[0].connectionId });
    expect(await inTenant(0, tx => tx.select().from(calendarEvents).where(eq(calendarEvents.id, id)))).toEqual([]);
    const restarted = createDb(URL!);
    try { await withHouseholdContext(restarted, fixtures[0].householdId, tx => processOutboxForConnection(tx, env, fixtures[0].connectionId)); }
    finally { await closeDb(restarted); }
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(`/events/${id.replaceAll("-", "")}`), expect.objectContaining({ method: "DELETE" }));
    expect(await outbox()).toEqual([]);
  });

  it("retains a failed delete, exposes its error, suppresses reimport, and succeeds on retry", async () => {
    const id = await create(); await drain();
    await request(0, `/events/${id}`, "DELETE");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await drain();
    expect((await outbox())[0]).toMatchObject({ eventId: null, attempts: 1, lastError: expect.stringContaining("HTTP 503") });
    const status = await inTenant(0, tx => buildCalendarSyncStatus(tx, fixtures[0]));
    expect(status).toMatchObject({ pendingExports: 1, run: { status: "failed", active: false, error: expect.stringContaining("HTTP 503") } });
    for (const runStatus of ["queued", "syncing"]) {
      await inTenant(0, async tx => {
        await markSyncQueued(tx, fixtures[0].connectionId);
        await tx.update(calendarConnections).set({ syncRunStatus: runStatus });
        expect(await buildCalendarSyncStatus(tx, fixtures[0])).toMatchObject({ run: { status: runStatus, active: true, error: null } });
      });
    }
    state.pullItems = [{ id: id.replaceAll("-", ""), summary: "Would be resurrected", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } }];
    await inTenant(0, tx => pullLinkedCalendar(tx, env, fixtures[0].linkedId));
    expect(await inTenant(0, tx => tx.select().from(calendarEvents))).toEqual([]);
    await drain(); expect(await outbox()).toEqual([]);
  });

  it.each([404, 410])("accepts already absent Google events (HTTP %s)", async status => {
    const id = await create(); await drain(); await request(0, `/events/${id}`, "DELETE");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status })); await drain();
    expect(await outbox()).toEqual([]);
  });

  it("cancels a pending create and uses its deterministic Google ID for cleanup", async () => {
    const id = await create(); await request(0, `/events/${id}`, "DELETE");
    expect(await outbox()).toHaveLength(1);
    await drain();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(id.replaceAll("-", "")), expect.objectContaining({ method: "DELETE" }));
  });

  it("never exposes or deletes another household's tombstone", async () => {
    const otherId = await create(1); await request(1, `/events/${otherId}`, "DELETE");
    expect(await outbox()).toEqual([]);
    expect((await request(0, `/events/${otherId}`, "DELETE")).status).toBe(404);
    await drain(); expect(fetchMock).not.toHaveBeenCalled();
    expect(await outbox(1)).toHaveLength(1);
    await expect(inTenant(0, tx => tx.insert(calendarSyncOutbox).values({ householdId: fixtures[0].householdId, connectionId: fixtures[1].connectionId, operation: "delete" }))).rejects.toThrow();
  });

  it("keeps import-only deletions local and refuses remapped Google destinations", async () => {
    const local = await create();
    await inTenant(0, tx => tx.update(calendarConnections).set({ syncMode: "import_only" }));
    await request(0, `/events/${local}`, "DELETE"); expect(await outbox()).toEqual([]);
    await inTenant(0, tx => tx.update(calendarConnections).set({ syncMode: "bidirectional" }));
    const id = await create(); await drain(); await request(0, `/events/${id}`, "DELETE");
    await inTenant(0, tx => tx.update(linkedGoogleCalendars).set({ googleCalendarId: "different-destination" }));
    fetchMock.mockClear(); await drain();
    expect(fetchMock).not.toHaveBeenCalled(); expect(await outbox()).toEqual([]);
    expect(await inTenant(0, tx => buildCalendarSyncStatus(tx, fixtures[0]))).toMatchObject({ run: { status: "failed", error: expect.stringContaining("mapping changed") } });
  });

  it("rejects invalid creates and PATCH ranges before they reach the outbox", async () => {
    expect((await request(0, "/events", "POST", { title: "Invalid", calendarId: fixtures[0].calendarId, startDate: "2026-10-20", startTime: "20:00", endTime: "10:00" })).status).toBe(400);
    expect(await outbox()).toEqual([]);
    const id = await create();
    expect((await request(0, `/events/${id}`, "PATCH", { endTime: "10:00" })).status).toBe(400);
    const [event] = await inTenant(0, tx => tx.select().from(calendarEvents).where(eq(calendarEvents.id, id)));
    expect(event.endTime).toBe("21:00:00");
  });

  it("reports a legacy invalid event as failed instead of silently completing its export", async () => {
    const id = await create();
    await inTenant(0, tx => tx.update(calendarEvents).set({ endTime: "10:00" }).where(eq(calendarEvents.id, id)));
    await drain();
    expect(fetchMock).not.toHaveBeenCalled();
    const status = await inTenant(0, tx => buildCalendarSyncStatus(tx, fixtures[0]));
    expect(status).toMatchObject({ pendingExports: 1, run: { status: "failed", active: false, error: expect.stringContaining("End time must be after") } });
    expect((await outbox())[0].attempts).toBe(1);
    expect((await request(0, `/events/${id}`, "PATCH", { endTime: "21:00" })).status).toBe(200);
    await drain();
    expect(await outbox()).toEqual([]);
    expect(await inTenant(0, tx => buildCalendarSyncStatus(tx, fixtures[0]))).toMatchObject({ pendingExports: 0, run: { status: "idle", error: null } });
  });

  it("does not treat a Google permission error as a successful deletion", async () => {
    const id = await create(); await drain(); await request(0, `/events/${id}`, "DELETE");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 })); await drain();
    expect((await outbox())[0].lastError).toContain("access was denied");
  });


  it("commits deletion before the queue wakeup and keeps it committed if Redis fails", async () => {
    const id = await create(); await drain();
    let committed = false;
    state.enqueue.mockImplementationOnce(async () => {
      const intents = await outbox();
      committed = intents.length === 1 && intents[0].eventId === null;
      throw new Error("Synthetic Redis failure");
    });
    const response = await request(0, "/events/" + id, "DELETE");
    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(await inTenant(0, tx => tx.select().from(calendarEvents))).toEqual([]);
    await drain(); expect(await outbox()).toEqual([]);
  });

  it("reports and removes an undeliverable malformed deletion without calling Google", async () => {
    await inTenant(0, tx => tx.insert(calendarSyncOutbox).values({ householdId: fixtures[0].householdId, connectionId: fixtures[0].connectionId, operation: "delete", payloadJson: "not json" }));
    await drain();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await outbox()).toEqual([]);
    expect(await inTenant(0, tx => buildCalendarSyncStatus(tx, fixtures[0]))).toMatchObject({ run: { status: "failed", error: expect.stringContaining("no valid destination") } });
  });

  it("waits for an in-flight first export before deciding which Google event to delete", async () => {
    const id = await create();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    fetchMock.mockImplementationOnce(async () => {
      entered(); await gate;
      return new Response(JSON.stringify({ id: "google-first-export" }));
    });
    const exporting = drain();
    await started;
    let deleted = false;
    const deleting = request(0, `/events/${id}`, "DELETE").then(r => { deleted = true; return r; });
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(deleted).toBe(false);
    } finally { release(); }
    await exporting;
    expect((await deleting).status).toBe(200);
    expect(JSON.parse((await outbox())[0].payloadJson!).googleEventId).toBe("google-first-export");
    await drain();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/events/google-first-export"), expect.objectContaining({ method: "DELETE" }));
  });
});
