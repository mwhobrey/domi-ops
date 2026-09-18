import { describe, expect, it } from "vitest";
import {
  classifyConflict,
  intervalForCheckWindow,
  intervalForSpan,
  literalOverlap,
  padInterval,
} from "./schedule-conflict-math.js";

const UTC = "UTC";

describe("intervalForSpan", () => {
  it("timed event resolves start/end from date+time in its own timezone", () => {
    const span = intervalForSpan(
      { startDate: "2026-03-01", endDate: null, startTime: "09:00", endTime: "10:00", allDay: false, timeZone: UTC },
      UTC,
    );
    expect(span.start).toBe(Date.parse("2026-03-01T09:00:00.000Z"));
    expect(span.end).toBe(Date.parse("2026-03-01T10:00:00.000Z"));
  });

  it("null endTime is treated as a zero-duration point", () => {
    const span = intervalForSpan(
      { startDate: "2026-03-01", startTime: "09:00", endTime: null, allDay: false, timeZone: UTC },
      UTC,
    );
    expect(span.start).toBe(span.end);
  });

  it("all-day single-day spans midnight to midnight the next day", () => {
    const span = intervalForSpan({ startDate: "2026-03-01", allDay: true, timeZone: UTC }, UTC);
    expect(span.start).toBe(Date.parse("2026-03-01T00:00:00.000Z"));
    expect(span.end).toBe(Date.parse("2026-03-02T00:00:00.000Z"));
  });

  it("all-day multi-day span covers through the day after endDate", () => {
    const span = intervalForSpan(
      { startDate: "2026-03-01", endDate: "2026-03-03", allDay: true, timeZone: UTC },
      UTC,
    );
    expect(span.start).toBe(Date.parse("2026-03-01T00:00:00.000Z"));
    expect(span.end).toBe(Date.parse("2026-03-04T00:00:00.000Z"));
  });

  it("falls back to household timezone when the event has none", () => {
    const withFallback = intervalForSpan(
      { startDate: "2026-03-01", startTime: "09:00", endTime: "10:00", allDay: false, timeZone: null },
      "America/Chicago",
    );
    const explicit = intervalForSpan(
      { startDate: "2026-03-01", startTime: "09:00", endTime: "10:00", allDay: false, timeZone: "America/Chicago" },
      UTC,
    );
    expect(withFallback).toEqual(explicit);
  });
});

describe("intervalForCheckWindow", () => {
  it("mode 'at' produces a zero-width point", () => {
    const win = intervalForCheckWindow({ mode: "at", date: "2026-03-01", time: "14:00", timeZone: UTC }, UTC);
    expect(win.start).toBe(win.end);
    expect(win.start).toBe(Date.parse("2026-03-01T14:00:00.000Z"));
  });

  it("mode 'range' defaults endDate to startDate", () => {
    const win = intervalForCheckWindow(
      { mode: "range", startDate: "2026-03-01", startTime: "14:00", endTime: "15:00", timeZone: UTC },
      UTC,
    );
    expect(win.start).toBe(Date.parse("2026-03-01T14:00:00.000Z"));
    expect(win.end).toBe(Date.parse("2026-03-01T15:00:00.000Z"));
  });
});

describe("literalOverlap", () => {
  const range = (startIso: string, endIso: string) => ({
    start: Date.parse(startIso),
    end: Date.parse(endIso),
  });
  const point = (iso: string) => ({ start: Date.parse(iso), end: Date.parse(iso) });

  it("fully-contained ranges overlap", () => {
    expect(
      literalOverlap(range("2026-03-01T09:00Z", "2026-03-01T11:00Z"), range("2026-03-01T09:30Z", "2026-03-01T10:00Z")),
    ).toBe(true);
  });

  it("partially-overlapping ranges overlap (both directions)", () => {
    expect(
      literalOverlap(range("2026-03-01T09:00Z", "2026-03-01T10:00Z"), range("2026-03-01T09:30Z", "2026-03-01T10:30Z")),
    ).toBe(true);
    expect(
      literalOverlap(range("2026-03-01T09:30Z", "2026-03-01T10:30Z"), range("2026-03-01T09:00Z", "2026-03-01T10:00Z")),
    ).toBe(true);
  });

  it("non-overlapping ranges don't overlap", () => {
    expect(
      literalOverlap(range("2026-03-01T09:00Z", "2026-03-01T10:00Z"), range("2026-03-01T11:00Z", "2026-03-01T12:00Z")),
    ).toBe(false);
  });

  it("back-to-back ranges (touching boundary) don't count as red", () => {
    expect(
      literalOverlap(range("2026-03-01T09:00Z", "2026-03-01T10:00Z"), range("2026-03-01T10:00Z", "2026-03-01T11:00Z")),
    ).toBe(false);
  });

  it("a point inside a range overlaps (inclusive at both boundaries)", () => {
    const r = range("2026-03-01T09:00Z", "2026-03-01T10:00Z");
    expect(literalOverlap(point("2026-03-01T09:30Z"), r)).toBe(true);
    expect(literalOverlap(point("2026-03-01T09:00Z"), r)).toBe(true);
    expect(literalOverlap(point("2026-03-01T10:00Z"), r)).toBe(true);
  });

  it("a point outside a range doesn't overlap", () => {
    const r = range("2026-03-01T09:00Z", "2026-03-01T10:00Z");
    expect(literalOverlap(point("2026-03-01T08:59Z"), r)).toBe(false);
    expect(literalOverlap(point("2026-03-01T10:01Z"), r)).toBe(false);
  });

  it("two equal points overlap; two different points don't", () => {
    expect(literalOverlap(point("2026-03-01T09:00Z"), point("2026-03-01T09:00Z"))).toBe(true);
    expect(literalOverlap(point("2026-03-01T09:00Z"), point("2026-03-01T09:01Z"))).toBe(false);
  });
});

describe("padInterval", () => {
  it("pads start backward and end forward by the given minutes", () => {
    const padded = padInterval(
      { start: Date.parse("2026-03-01T09:00:00.000Z"), end: Date.parse("2026-03-01T10:00:00.000Z") },
      15,
      30,
    );
    expect(padded.start).toBe(Date.parse("2026-03-01T08:45:00.000Z"));
    expect(padded.end).toBe(Date.parse("2026-03-01T10:30:00.000Z"));
  });

  it("zero buffer leaves the interval unchanged", () => {
    const original = { start: Date.parse("2026-03-01T09:00:00.000Z"), end: Date.parse("2026-03-01T10:00:00.000Z") };
    expect(padInterval(original, 0, 0)).toEqual(original);
  });
});

describe("classifyConflict", () => {
  const checkInterval = { start: Date.parse("2026-03-01T09:00:00.000Z"), end: Date.parse("2026-03-01T09:00:00.000Z") };

  it("returns red for literal overlap regardless of buffers", () => {
    const result = classifyConflict({
      checkInterval,
      eventInterval: { start: Date.parse("2026-03-01T08:30:00.000Z"), end: Date.parse("2026-03-01T09:30:00.000Z") },
      eventBufferBeforeMinutes: 60,
      eventBufferAfterMinutes: 60,
    });
    expect(result).toEqual({ severity: "red", reason: "literal_overlap" });
  });

  it("returns yellow when the event's own buffer reaches the check (before)", () => {
    const result = classifyConflict({
      checkInterval,
      eventInterval: { start: Date.parse("2026-03-01T09:30:00.000Z"), end: Date.parse("2026-03-01T10:00:00.000Z") },
      eventBufferBeforeMinutes: 45,
      eventBufferAfterMinutes: 0,
    });
    expect(result).toEqual({ severity: "yellow", reason: "event_buffer_encroachment" });
  });

  it("returns yellow when the event's own buffer reaches the check (after)", () => {
    const result = classifyConflict({
      checkInterval,
      eventInterval: { start: Date.parse("2026-03-01T08:00:00.000Z"), end: Date.parse("2026-03-01T08:30:00.000Z") },
      eventBufferBeforeMinutes: 0,
      eventBufferAfterMinutes: 45,
    });
    expect(result).toEqual({ severity: "yellow", reason: "event_buffer_encroachment" });
  });

  it("returns yellow when the check's own ad-hoc buffer reaches the event", () => {
    const result = classifyConflict({
      checkInterval,
      checkBufferBeforeMinutes: 0,
      checkBufferAfterMinutes: 45,
      eventInterval: { start: Date.parse("2026-03-01T09:30:00.000Z"), end: Date.parse("2026-03-01T10:00:00.000Z") },
    });
    expect(result).toEqual({ severity: "yellow", reason: "check_buffer_encroachment" });
  });

  it("returns null severity when nothing is close, even with buffers", () => {
    const result = classifyConflict({
      checkInterval,
      checkBufferBeforeMinutes: 5,
      checkBufferAfterMinutes: 5,
      eventInterval: { start: Date.parse("2026-03-01T12:00:00.000Z"), end: Date.parse("2026-03-01T13:00:00.000Z") },
      eventBufferBeforeMinutes: 5,
      eventBufferAfterMinutes: 5,
    });
    expect(result).toEqual({ severity: null, reason: null });
  });

  it("treats null/undefined buffer minutes as 0", () => {
    const result = classifyConflict({
      checkInterval,
      eventInterval: { start: Date.parse("2026-03-01T09:30:00.000Z"), end: Date.parse("2026-03-01T10:00:00.000Z") },
      eventBufferBeforeMinutes: null,
      eventBufferAfterMinutes: null,
    });
    expect(result).toEqual({ severity: null, reason: null });
  });
});
