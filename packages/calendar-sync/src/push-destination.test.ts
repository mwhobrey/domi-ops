import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@domi-ops/config";
import { calendarConnections, calendarEvents, calendarSyncOutbox, linkedGoogleCalendars, type Database } from "@domi-ops/db";
import { processOutboxForConnection, pushEventCreate, pushEventUpdate } from "./push.js";

vi.mock("./client.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./client.js")>(),
  ensureAccessToken: vi.fn(async () => "test-access-token"),
}));
vi.mock("./event-reminders.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./event-reminders.js")>(),
  listReminderOffsetsForEvent: vi.fn(async () => []),
}));

describe("queued Google push destination", () => {
  let event: Record<string, unknown>;
  let linked: Record<string, unknown>;
  let outbox: Record<string, unknown>[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let locks: number;
  const removed: unknown[] = [];
  const updates: unknown[] = [];

  const db = {
    select: () => ({ from: (table: unknown) => {
      const rows = table === calendarEvents ? [event]
        : table === linkedGoogleCalendars ? [linked]
          : table === calendarConnections ? [{ id: "connection", syncMode: "bidirectional", timeZone: "UTC" }]
            : table === calendarSyncOutbox ? outbox : [];
      const result = Object.assign(Promise.resolve(rows), {
        where: () => result, limit: () => result, orderBy: () => result,
        for: () => { locks += 1; return result; },
      });
      return result;
    } }),
    update: () => ({ set: (patch: unknown) => ({ where: async () => { updates.push(patch); } }) }),
    delete: (table: unknown) => ({ where: async () => { removed.push(table); } }),
  } as unknown as Database;
  const env = {} as Env;

  beforeEach(() => {
    event = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", calendarId: "calendar-a",
      title: "Demo event", description: null, location: null, googleEventId: null,
      startDate: "2026-10-20", endDate: null, startTime: "14:00", endTime: "15:00",
      allDay: false, timeZone: "UTC", syncStatus: "pending",
    };
    linked = {
      id: "linked-a", connectionId: "connection", targetCalendarId: "calendar-a",
      googleCalendarId: "google-a", syncEnabled: true,
    };
    outbox = [];
    locks = 0;
    removed.length = 0;
    updates.length = 0;
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "google-event", etag: "etag" })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["create", "update"])("does not send newer private contents to a stale %s destination", async (operation) => {
    event.calendarId = "private-calendar-b";
    event.description = "New contents added after moving away from calendar A";
    if (operation === "update") event.googleEventId = "google-event";
    const push = operation === "create" ? pushEventCreate : pushEventUpdate;
    expect(await push(db, env, String(event.id), "linked-a")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("does not export through a disabled calendar mapping", async () => {
    linked.syncEnabled = false;
    expect(await pushEventCreate(db, env, String(event.id), "linked-a")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["create", "update"])("locks the event and delivers a valid %s to its current destination", async (operation) => {
    if (operation === "update") event.googleEventId = "google-event";
    const push = operation === "create" ? pushEventCreate : pushEventUpdate;
    expect(await push(db, env, String(event.id), "linked-a")).toBe(true);
    expect(locks).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/calendars/google-a/events"), expect.objectContaining({
      method: operation === "create" ? "POST" : "PUT",
    }));
  });

  it("discards a superseded outbox intent without exporting or changing the moved event", async () => {
    event.calendarId = "private-calendar-b";
    outbox = [{ id: "old-intent", eventId: event.id, operation: "create", payloadJson: JSON.stringify({ linkedCalendarId: "linked-a" }) }];
    await processOutboxForConnection(db, env, "connection");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removed).toEqual([calendarSyncOutbox]);
    expect(updates).toEqual([]);
  });

  it("delivers a save queued during the first export as an update once the Google ID exists", async () => {
    event.googleEventId = "google-event";
    event.title = "Edited while the first export was in flight";
    expect(await pushEventCreate(db, env, String(event.id), "linked-a")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/events/google-event"), expect.objectContaining({
      method: "PUT", body: expect.stringContaining(String(event.title)),
    }));
  });

  it("ignores a completed duplicate create intent", async () => {
    event.googleEventId = "google-event";
    event.syncStatus = "synced";
    expect(await pushEventCreate(db, env, String(event.id), "linked-a")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
