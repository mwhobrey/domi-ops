import { describe, expect, it } from "vitest";
import {
  isAttendanceStatus,
  isIsoDate,
  minutesToHours,
  parseMinutes,
  summarizeSchoolDays,
  tallyAttendance,
  totalMinutes,
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

describe("summarizeSchoolDays", () => {
  it("counts a day attended if any class was present or late", () => {
    const s = summarizeSchoolDays([
      { attendanceDate: "2026-09-01", status: "absent" },
      { attendanceDate: "2026-09-01", status: "present" },
      { attendanceDate: "2026-09-02", status: "late" },
    ]);
    expect(s).toEqual({ daysAttended: 2, daysRecorded: 2, daysAbsent: 0, daysExcused: 0 });
  });

  it("counts absent only when every entry that day was absent", () => {
    const s = summarizeSchoolDays([
      { attendanceDate: "2026-09-03", status: "absent" },
      { attendanceDate: "2026-09-03", status: "absent" },
    ]);
    expect(s).toMatchObject({ daysAttended: 0, daysAbsent: 1, daysExcused: 0 });
  });

  it("counts excused days separately, even alongside an absence", () => {
    const s = summarizeSchoolDays([
      { attendanceDate: "2026-09-04", status: "excused" },
      { attendanceDate: "2026-09-04", status: "absent" },
    ]);
    expect(s).toMatchObject({ daysAttended: 0, daysAbsent: 0, daysExcused: 1 });
  });

  it("handles no data", () => {
    expect(summarizeSchoolDays([])).toEqual({
      daysAttended: 0,
      daysRecorded: 0,
      daysAbsent: 0,
      daysExcused: 0,
    });
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
