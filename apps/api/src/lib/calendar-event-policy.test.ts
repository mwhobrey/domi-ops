import { describe, expect, it } from "vitest";
import {
  computeEventPolicy,
  isGooglePushPatch,
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
