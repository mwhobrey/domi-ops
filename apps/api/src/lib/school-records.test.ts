import { describe, expect, it } from "vitest";
import {
  isAttendanceStatus,
  buildDayActivity,
  isIsoDate,
  minutesToHours,
  parseMinutes,
  tallyAttendance,
  totalMinutes,
  weekdaysBetween,
} from "./school-records.js";

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2026-09-29")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-9-29")).toBe(false);
    expect(isIsoDate("2026-09-29T00:00:00Z")).toBe(false);
    expect(isIsoDate(20260929)).toBe(false);
  });
});

describe("isAttendanceStatus", () => {
  it("matches the enum", () => {
    expect(isAttendanceStatus("present")).toBe(true);
    expect(isAttendanceStatus("tardy")).toBe(false);
    expect(isAttendanceStatus(undefined)).toBe(false);
  });
});

describe("tallyAttendance", () => {
  it("counts each status and the total", () => {
    const t = tallyAttendance([
      { status: "present" },
      { status: "present" },
      { status: "late" },
      { status: "absent" },
      { status: "excused" },
    ]);
    expect(t).toEqual({ present: 2, late: 1, absent: 1, excused: 1, recorded: 5 });
  });
});

describe("buildDayActivity", () => {
  const none = { markedDays: [], hours: [], attendance: [] };

  it("counts a day from any one source", () => {
    const days = buildDayActivity({
      markedDays: ["2026-09-01"],
      hours: [{ logDate: "2026-09-02", minutes: 90 }],
      attendance: [{ attendanceDate: "2026-09-03", status: "present" }],
    });
    expect(days.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(days[0]).toMatchObject({ marked: true, minutes: 0, classAttendance: false });
    expect(days[1]).toMatchObject({ marked: false, minutes: 90 });
    expect(days[2]).toMatchObject({ classAttendance: true });
  });

  it("counts a day once however many sources agree, and sums minutes", () => {
    const days = buildDayActivity({
      markedDays: ["2026-09-01"],
      hours: [
        { logDate: "2026-09-01", minutes: 60 },
        { logDate: "2026-09-01", minutes: 30 },
      ],
      attendance: [
        { attendanceDate: "2026-09-01", status: "late" },
        { attendanceDate: "2026-09-01", status: "present" },
      ],
    });
    expect(days).toEqual([{ date: "2026-09-01", marked: true, minutes: 90, classAttendance: true }]);
  });

  it("never counts absent or excused marks, or zero-minute hours", () => {
    const days = buildDayActivity({
      markedDays: [],
      hours: [{ logDate: "2026-09-04", minutes: 0 }],
      attendance: [
        { attendanceDate: "2026-09-05", status: "absent" },
        { attendanceDate: "2026-09-06", status: "excused" },
      ],
    });
    expect(days).toEqual([]);
  });

  it("sorts by date and handles no data", () => {
    expect(buildDayActivity(none)).toEqual([]);
    const days = buildDayActivity({ ...none, markedDays: ["2026-09-03", "2026-09-01"] });
    expect(days.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-03"]);
  });
});

describe("weekdaysBetween", () => {
  it("skips weekends and includes both ends", () => {
    // 2026-09-28 is a Monday.
    expect(weekdaysBetween("2026-09-28", "2026-10-04")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("returns nothing for a weekend-only or backwards range", () => {
    expect(weekdaysBetween("2026-10-03", "2026-10-04")).toEqual([]);
    expect(weekdaysBetween("2026-10-05", "2026-10-01")).toEqual([]);
  });
});

describe("hours", () => {
  it("totals and converts", () => {
    expect(totalMinutes([{ minutes: 45 }, { minutes: 45 }, { minutes: 30 }])).toBe(120);
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.7);
    expect(minutesToHours(0)).toBe(0);
  });

  it("only accepts whole minutes within a day", () => {
    expect(parseMinutes(60)).toBe(60);
    expect(parseMinutes(1440)).toBe(1440);
    expect(parseMinutes(0)).toBeNull();
    expect(parseMinutes(1441)).toBeNull();
    expect(parseMinutes(1.5)).toBeNull();
    expect(parseMinutes("60")).toBeNull();
  });
});
