import { describe, expect, it } from "vitest";
import {
  MAX_DRIVE_BUFFER_MINUTES,
  isValidIsoDate,
  isValidTime,
  isValidTimeZone,
  parseDriveBufferMinutes,
} from "./schedule-conflict-input.js";

describe("isValidIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidIsoDate("2026-09-18")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidIsoDate("2026-9-18")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
    expect(isValidIsoDate("garbage")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("isValidTime", () => {
  it("accepts HH:mm and HH:mm:ss", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("09:30:00")).toBe(true);
  });

  it("rejects out-of-range and malformed times", () => {
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("09:60")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
    expect(isValidTime("noon")).toBe(false);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects unknown ones", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("parseDriveBufferMinutes", () => {
  it("passes omitted and null through", () => {
    expect(parseDriveBufferMinutes(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseDriveBufferMinutes(null)).toEqual({ ok: true, value: null });
  });

  it("accepts integers from 0 through the max", () => {
    expect(parseDriveBufferMinutes(0)).toEqual({ ok: true, value: 0 });
    expect(parseDriveBufferMinutes(45)).toEqual({ ok: true, value: 45 });
    expect(parseDriveBufferMinutes(MAX_DRIVE_BUFFER_MINUTES)).toEqual({
      ok: true,
      value: MAX_DRIVE_BUFFER_MINUTES,
    });
  });

  it("rejects negatives, fractions, over-max, and non-numbers", () => {
    expect(parseDriveBufferMinutes(-1)).toEqual({ ok: false });
    expect(parseDriveBufferMinutes(1.5)).toEqual({ ok: false });
    expect(parseDriveBufferMinutes(MAX_DRIVE_BUFFER_MINUTES + 1)).toEqual({ ok: false });
    expect(parseDriveBufferMinutes("30")).toEqual({ ok: false });
    expect(parseDriveBufferMinutes(Number.NaN)).toEqual({ ok: false });
  });
});
