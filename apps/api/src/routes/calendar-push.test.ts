import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type { CalendarEventRow } from "../lib/calendar-event-policy.js";
import { calendarRoutes } from "./calendar.js";

const state = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
  mode: "bidirectional",
  owner: "owner",
  outbox: [] as Record<string, unknown>[],
  enqueue: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("auth", { householdId: "household", userId: "owner" });
    await next();
  },
}));
vi.mock("../lib/household-modules.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/household-modules.js")>(),
  requireHouseholdModule: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("../lib/calendar-lanes.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/calendar-lanes.js")>(),
  canWriteCalendar: vi.fn(async () => true),
}));
vi.mock("../lib/calendar-event-policy.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/calendar-event-policy.js")>(),
  loadEventPolicyContext: vi.fn(async () => ({
    userId: "owner",
    linkedByTargetCalendar: new Map([["google-target", {
      connectionId: "connection", linkedCalendarId: "linked-calendar",
      syncMode: state.mode, connectionUserId: state.owner,
    }]]),
  })),
}));
vi.mock("../lib/calendar-event-enrich.js", () => ({
  enrichEventDto: vi.fn(async (_db, _householdId, event, policy) => ({ ...event, ...policy })),
}));
vi.mock("@domi-ops/calendar-sync", async (importOriginal) => ({
  ...await importOriginal<typeof import("@domi-ops/calendar-sync")>(),
  enqueueSyncJob: state.enqueue,
}));

describe("saving events on a bidirectional Google calendar", () => {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.event] }) }) }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: () => ({
      returning: async () => {
        state.event = { ...state.event, ...patch };
        return [state.event];
      },
    }) }) }),
    insert: () => ({ values: async (value: Record<string, unknown>) => { state.outbox.push(value); } }),
  } as unknown as Database;
  const app = calendarRoutes(db, { MODULES_ENABLED: ["calendar_sync"], REDIS_URL: "redis://unused" } as Env);

  beforeEach(() => {
    vi.clearAllMocks();
    state.mode = "bidirectional";
    state.owner = "owner";
    state.outbox = [];
    state.event = {
      id: "event", householdId: "household", calendarId: "google-target",
      title: "Demo created before linking", description: null, location: null,
      source: "local", syncStatus: "synced", googleEventId: null,
      recurringRuleId: null, startDate: "2026-10-20", startTime: "14:00",
      endDate: null, endTime: "15:00", allDay: false,
    } satisfies Partial<CalendarEventRow>;
  });

  async function save(patch: Record<string, unknown>) {
    return app.request("/events/event", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    });
  }

  it("queues a first create and marks pending when an unexported event is explicitly saved", async () => {
    const res = await save({ title: state.event.title });
    expect(res.status).toBe(200);
    expect(state.event.syncStatus).toBe("pending");
    expect(state.outbox).toEqual([{
      eventId: "event", operation: "create", payloadJson: JSON.stringify({ linkedCalendarId: "linked-calendar" }),
    }]);
    expect(state.enqueue).toHaveBeenCalledWith("redis://unused", "google.calendar.push", {
      connectionId: "connection", householdId: "household", userId: "owner",
    });
  });

  it("queues first create when a local event moves into the linked calendar", async () => {
    state.event.calendarId = "local-target";
    expect((await save({ calendarId: "google-target" })).status).toBe(200);
    expect(state.outbox[0]?.operation).toBe("create");
  });

  it("updates an already exported Domi-created event", async () => {
    state.event.googleEventId = "google-event";
    expect((await save({ title: "Renamed after exporting" })).status).toBe(200);
    expect(state.outbox[0]?.operation).toBe("update");
  });

  it.each(["import-only", "different-owner", "unlinked"])("does not export for %s", async (scenario) => {
    if (scenario === "import-only") state.mode = "import_only";
    if (scenario === "different-owner") state.owner = "someone-else";
    if (scenario === "unlinked") state.event.calendarId = "local-target";
    expect((await save({ title: "Local edit" })).status).toBe(200);
    expect(state.outbox).toEqual([]);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});
