import { describe, expect, it } from "vitest";
import { groupCoversCheckSlot } from "./health-check-group-reminders.js";
import { zonedLocalToUtc } from "./household-time.js";

const TZ = "America/Chicago";
const at = (date: string, time: string) => zonedLocalToUtc(date, time, TZ);
const group = (over: Record<string, unknown> = {}) => ({
  scheduleKind: "scheduled" as const,
  scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }),
  startDate: null as string | null,
  endDate: null as string | null,
  ...over,
});
const scheduledCheck = { scheduleKind: "scheduled" as const };

describe("groupCoversCheckSlot", () => {
  it("covers a scheduled check's slot at one of the group's times, on any day", () => {
    expect(groupCoversCheckSlot(group(), scheduledCheck, at("2026-10-05", "08:00"), TZ)).toBe(true);
    expect(groupCoversCheckSlot(group(), scheduledCheck, at("2027-03-01", "20:00"), TZ)).toBe(true);
    expect(groupCoversCheckSlot(group(), scheduledCheck, at("2026-10-05", "12:00"), TZ)).toBe(false);
  });

  it("reads the group's times in the zone asked about, not in UTC", () => {
    // 08:00 Chicago is 13:00Z in October; as a UTC clock time that is not a group time.
    expect(groupCoversCheckSlot(group(), scheduledCheck, new Date("2026-10-05T13:00:00Z"), TZ)).toBe(true);
    expect(groupCoversCheckSlot(group(), scheduledCheck, new Date("2026-10-05T13:00:00Z"), "UTC")).toBe(false);
  });

  it("follows the group's weekdays and dates", () => {
    const mondays = group({ scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) });
    expect(groupCoversCheckSlot(mondays, scheduledCheck, at("2026-10-05", "08:00"), TZ)).toBe(true); // Monday
    expect(groupCoversCheckSlot(mondays, scheduledCheck, at("2026-10-06", "08:00"), TZ)).toBe(false); // Tuesday
    expect(groupCoversCheckSlot(group({ startDate: "2026-10-06" }), scheduledCheck, at("2026-10-05", "08:00"), TZ)).toBe(false);
    expect(groupCoversCheckSlot(group({ endDate: "2026-10-04" }), scheduledCheck, at("2026-10-05", "08:00"), TZ)).toBe(false);
  });

  it("only joins scheduled checks to scheduled groups", () => {
    expect(groupCoversCheckSlot(group(), { scheduleKind: "interval" }, at("2026-10-05", "08:00"), TZ)).toBe(false);
    expect(groupCoversCheckSlot(group({ scheduleKind: "interval" }), scheduledCheck, at("2026-10-05", "08:00"), TZ)).toBe(false);
  });
});
