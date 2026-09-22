import { describe, expect, it } from "vitest";
import {
  adjustTimedEventEndOnStartChange,
  addMinutesToLocalDateTime,
} from "./event-form-times";

describe("addMinutesToLocalDateTime", () => {
  it("adds one hour on the same calendar day", () => {
    expect(addMinutesToLocalDateTime("2026-09-18", "09:00", 60)).toEqual({
      date: "2026-09-18",
      time: "10:00",
    });
  });

  it("rolls to the next day when needed", () => {
    expect(addMinutesToLocalDateTime("2026-09-18", "23:30", 60)).toEqual({
      date: "2026-09-19",
      time: "00:30",
    });
  });
});

describe("adjustTimedEventEndOnStartChange", () => {
  const base = {
    startDate: "2026-09-18",
    endDate: "",
    previousStartDate: "2026-09-18",
    previousStartTime: "09:00",
    endTime: "10:00",
  };

  it("snaps end to new start + 1h when end matched the old default", () => {
    const result = adjustTimedEventEndOnStartChange({
      ...base,
      newStartDate: "2026-09-18",
      newStartTime: "11:00",
    });
    expect(result).toEqual({ endTime: "12:00", endDate: "2026-09-18" });
  });

  it("snaps end when end time equals start (invalid duration)", () => {
    const result = adjustTimedEventEndOnStartChange({
      ...base,
      endTime: "09:00",
      newStartDate: "2026-09-18",
      newStartTime: "14:00",
    });
    expect(result).toEqual({ endTime: "15:00", endDate: "2026-09-18" });
  });

  it("preserves a custom duration when end was not the default", () => {
    const result = adjustTimedEventEndOnStartChange({
      ...base,
      endTime: "10:30",
      newStartDate: "2026-09-18",
      newStartTime: "11:00",
    });
    expect(result).toEqual({ endTime: "12:30", endDate: "2026-09-18" });
  });

  it("updates end date when the default slot crosses midnight", () => {
    const result = adjustTimedEventEndOnStartChange({
      startDate: "2026-09-18",
      endDate: "2026-09-19",
      previousStartDate: "2026-09-18",
      previousStartTime: "23:00",
      endTime: "00:00",
      newStartDate: "2026-09-18",
      newStartTime: "22:00",
    });
    expect(result).toEqual({ endTime: "23:00", endDate: "2026-09-18" });
  });
});
