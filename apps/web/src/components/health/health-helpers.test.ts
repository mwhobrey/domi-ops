import { describe, expect, it } from "vitest";
import {
  formatEventWhen,
  groupMedsByMember,
  groupPendingDosesByMemberThenTime,
  memberLabel,
  mergeTodayEntriesForMember,
  resolveDefaultMemberId,
  scheduleKindLabel,
} from "./health-helpers";
import type { HealthEvent, HealthMedication, PendingDose, PendingGroupDose } from "./health-types";

describe("scheduleKindLabel", () => {
  it("labels each schedule kind", () => {
    expect(scheduleKindLabel("prn")).toBe("PRN");
    expect(scheduleKindLabel("interval")).toBe("Every…");
    expect(scheduleKindLabel("scheduled")).toBe("Scheduled");
  });
});

describe("memberLabel / resolveDefaultMemberId", () => {
  const members = [
    { memberId: "m1", label: "Alex" },
    { memberId: "m2", label: "Sam" },
  ];

  it("looks up a member's label, falling back to a generic one", () => {
    expect(memberLabel(members, "m1")).toBe("Alex");
    expect(memberLabel(members, "missing")).toBe("Member");
  });

  it("keeps the current member if they're in the list", () => {
    expect(resolveDefaultMemberId("m2", members)).toBe("m2");
  });

  it("falls back to the first member when the current one isn't in the list", () => {
    expect(resolveDefaultMemberId("missing", members)).toBe("m1");
    expect(resolveDefaultMemberId("", members)).toBe("m1");
  });

  it("returns empty string when there are no members at all", () => {
    expect(resolveDefaultMemberId("m1", [])).toBe("");
  });
});

describe("groupPendingDosesByMemberThenTime", () => {
  it("buckets doses by member, then by time (sorted)", () => {
    const doses: PendingDose[] = [
      { medicationId: "a", name: "A", scheduledAt: "", scheduledTime: "08:00", scheduledTimeLabel: "8am", memberId: "m1" },
      { medicationId: "b", name: "B", scheduledAt: "", scheduledTime: "20:00", scheduledTimeLabel: "8pm", memberId: "m1" },
      { medicationId: "c", name: "C", scheduledAt: "", scheduledTime: "08:00", scheduledTimeLabel: "8am", memberId: "m2" },
    ];
    const grouped = groupPendingDosesByMemberThenTime(doses);
    expect(grouped).toHaveLength(2);
    const m1 = grouped.find((g) => g.memberId === "m1")!;
    expect(m1.times.map((t) => t.scheduledTime)).toEqual(["08:00", "20:00"]);
    expect(m1.times[0].doses).toHaveLength(1);
  });
});

describe("groupMedsByMember", () => {
  it("groups medications by memberId, preserving encounter order", () => {
    const meds = [
      { id: "1", memberId: "m1" },
      { id: "2", memberId: "m2" },
      { id: "3", memberId: "m1" },
    ] as HealthMedication[];
    const grouped = groupMedsByMember(meds);
    expect(grouped.map((g) => g.memberId)).toEqual(["m1", "m2"]);
    expect(grouped[0].meds.map((m) => m.id)).toEqual(["1", "3"]);
  });
});

describe("mergeTodayEntriesForMember", () => {
  it("interleaves ad-hoc time buckets and persisted groups by scheduledTime", () => {
    const adhoc = [{ scheduledTime: "12:00", label: "Noon", doses: [] as PendingDose[] }];
    const groups: PendingGroupDose[] = [
      { groupId: "g1", name: "Morning meds", scheduledAt: "", scheduledTime: "08:00", scheduledTimeLabel: "8am", memberId: "m1", medications: [] },
    ];
    const merged = mergeTodayEntriesForMember(adhoc, groups);
    expect(merged.map((e) => e.scheduledTime)).toEqual(["08:00", "12:00"]);
    expect(merged[0].kind).toBe("group");
    expect(merged[1].kind).toBe("adhoc");
  });
});

describe("formatEventWhen", () => {
  const base: HealthEvent = {
    id: "1",
    memberId: "m1",
    medicationId: null,
    type: "other",
    title: "t",
    notes: null,
    startedAt: null,
    endedAt: null,
    visibility: "household",
  };

  it("formats a date-only event", () => {
    expect(formatEventWhen({ ...base, startDate: "2026-03-15" })).toBe("Mar 15, 2026");
  });

  it("formats a date + time event", () => {
    const result = formatEventWhen({ ...base, startDate: "2026-03-15", startTime: "09:30" });
    expect(result).toContain("Mar 15, 2026");
    expect(result).toContain("9:30");
  });

  it("falls back to startedAt when there's no startDate", () => {
    expect(formatEventWhen({ ...base, startedAt: "2026-03-15T09:30:00.000Z" })).not.toBeNull();
  });

  it("returns null when there's no date info at all", () => {
    expect(formatEventWhen(base)).toBeNull();
  });
});
