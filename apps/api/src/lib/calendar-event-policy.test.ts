import { describe, expect, it } from "vitest";
import {
  computeEventPolicy,
  isGooglePushPatch,
  planEventGooglePush,
  type EventPolicyContext,
} from "./calendar-event-policy.js";
import type { CalendarEventRow } from "./calendar-event-policy.js";

function row(
  partial: Partial<CalendarEventRow> & Pick<CalendarEventRow, "calendarId">,
): CalendarEventRow {
  return {
    id: "e1",
    householdId: "h1",
    title: "Test",
    description: null,
    categoryKey: null,
    color: null,
    startDate: "2026-06-04",
    endDate: null,
    startTime: "09:00",
    endTime: "10:00",
    timeZone: null,
    allDay: false,
    location: null,
    attendeeMemberIds: null,
    driveBufferBeforeMinutes: null,
    driveBufferAfterMinutes: null,
    source: "google",
    syncStatus: "synced",
    recurringRuleId: null,
    googleEventId: "gid-1",
    googleRecurringEventId: null,
    googleEtag: null,
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

const ctx = (userId: string, syncMode: "import_only" | "bidirectional"): EventPolicyContext => ({
  userId,
  linkedByTargetCalendar: new Map([
    [
      "cal-target",
      {
        connectionId: "conn-1",
        linkedCalendarId: "lc-1",
        syncMode,
        connectionUserId: userId,
      },
    ],
  ]),
});

describe("computeEventPolicy", () => {
  it("local events are editable but not pushable", () => {
    const p = computeEventPolicy(
      row({ source: "local", googleEventId: null, calendarId: "cal-local" }),
      ctx("u1", "bidirectional"),
    );
    expect(p).toEqual({ editable: true, pushable: false });
  });

  it("google import_only is editable but not pushable", () => {
    const p = computeEventPolicy(
      row({ calendarId: "cal-target" }),
      ctx("u1", "import_only"),
    );
    expect(p.editable).toBe(true);
    expect(p.pushable).toBe(false);
  });

  it("google bidirectional is pushable for connection owner", () => {
    const p = computeEventPolicy(
      row({ calendarId: "cal-target" }),
      ctx("u1", "bidirectional"),
    );
    expect(p).toMatchObject({
      editable: true,
      pushable: true,
      connectionId: "conn-1",
      linkedCalendarId: "lc-1",
    });
  });

  it("keeps a Domi-created event pushable after its first successful Google create", () => {
    const event = row({ source: "local", googleEventId: null, calendarId: "cal-target" });
    const context = ctx("u1", "bidirectional");
    expect(computeEventPolicy(event, context).pushable).toBe(false);

    event.googleEventId = "created-google-id";
    expect(computeEventPolicy(event, context)).toMatchObject({
      editable: true,
      pushable: true,
      connectionId: "conn-1",
      linkedCalendarId: "lc-1",
    });
    expect(isGooglePushPatch({ title: "Updated after first push" }, event)).toBe(true);
  });

  it("does not push a previously exported local event in import-only mode", () => {
    expect(computeEventPolicy(
      row({ source: "local", calendarId: "cal-target" }),
      ctx("u1", "import_only"),
    ).pushable).toBe(false);
  });

  it("does not push a previously exported local event through another member's connection", () => {
    const context = { ...ctx("u1", "bidirectional"), userId: "u2" };
    expect(computeEventPolicy(
      row({ source: "local", calendarId: "cal-target" }), context,
    ).pushable).toBe(false);
  });

  it("google bidirectional is not pushable for non-connection owner", () => {
    const p = computeEventPolicy(row({ calendarId: "cal-target" }), {
      userId: "u2",
      linkedByTargetCalendar: new Map([
        [
          "cal-target",
          {
            connectionId: "conn-1",
            linkedCalendarId: "lc-1",
            syncMode: "bidirectional",
            connectionUserId: "u1",
          },
        ],
      ]),
    });
    expect(p.editable).toBe(true);
    expect(p.pushable).toBe(false);
  });

  it("conflict rows are read-only", () => {
    const p = computeEventPolicy(
      row({ syncStatus: "conflict", calendarId: "cal-target" }),
      ctx("u1", "bidirectional"),
    );
    expect(p).toEqual({ editable: false, pushable: false });
  });
});

describe("isGooglePushPatch", () => {
  const base = row({ calendarId: "cal-target", location: "Clinic" });

  it("pushes title and location edits, not just schedule changes", () => {
    expect(isGooglePushPatch({ title: "Renamed" }, base)).toBe(true);
    expect(isGooglePushPatch({ location: null }, base)).toBe(true);
    expect(isGooglePushPatch({ startTime: "11:00" }, base)).toBe(true);
  });

  it("ignores unchanged values and Domi Ops-only fields", () => {
    expect(isGooglePushPatch({ title: "Test", location: "Clinic" }, base)).toBe(false);
    expect(isGooglePushPatch({ attendeeMemberIds: ["m1"] }, base)).toBe(false);
  });
});

describe("planEventGooglePush", () => {
  const local = row({ source: "local", googleEventId: null, calendarId: "cal-target" });

  it("queues first Google creation when an existing local event is saved after enabling sync", () => {
    expect(planEventGooglePush(local, ctx("u1", "bidirectional"), { title: local.title })).toEqual({
      operation: "create", connectionId: "conn-1", linkedCalendarId: "lc-1",
    });
  });

  it("uses the destination mapping when moving a local event to a Google-linked calendar", () => {
    expect(planEventGooglePush({ ...local, calendarId: "cal-local" }, ctx("u1", "bidirectional"), {
      calendarId: "cal-target",
    })?.operation).toBe("create");
  });

  it("does not create Google events for an unlinked destination, import-only mode, or another owner", () => {
    expect(planEventGooglePush(local, ctx("u1", "bidirectional"), { calendarId: "cal-local" })).toBeNull();
    expect(planEventGooglePush(local, ctx("u1", "import_only"), {})).toBeNull();
    expect(planEventGooglePush(local, { ...ctx("u1", "bidirectional"), userId: "u2" }, {})).toBeNull();
  });

  it("does not promote conflicting, recurring, or malformed imported rows", () => {
    const context = ctx("u1", "bidirectional");
    expect(planEventGooglePush({ ...local, syncStatus: "conflict" }, context, {})).toBeNull();
    expect(planEventGooglePush({ ...local, recurringRuleId: "rule-1" }, context, {})).toBeNull();
    expect(planEventGooglePush({ ...local, source: "google" }, context, {})).toBeNull();
  });

  it("updates an already exported local event and skips an unchanged exported event", () => {
    const exported = { ...local, googleEventId: "gid-1" };
    const context = ctx("u1", "bidirectional");
    expect(planEventGooglePush(exported, context, { title: "Updated" })).toEqual({
      operation: "update", connectionId: "conn-1", linkedCalendarId: "lc-1",
    });
    expect(planEventGooglePush(exported, context, { title: exported.title })).toBeNull();
  });
});
