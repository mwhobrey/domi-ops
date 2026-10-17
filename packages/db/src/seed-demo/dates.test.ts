import { afterEach, describe, expect, it, vi } from "vitest";
import { chicagoYmd, dueAtEndOfDayYmd } from "./dates.js";
afterEach(() => vi.useRealTimers());
describe("demo household calendar dates", () => {
  it("adds calendar days across spring and autumn clock changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T05:30:00Z"));
    expect(chicagoYmd(1)).toBe("2026-03-08");
    vi.setSystemTime(new Date("2026-11-01T05:30:00Z"));
    expect(chicagoYmd(1)).toBe("2026-11-02");
  });
  it("places end-of-day due dates at 23:59 Chicago in either offset", () => {
    expect(dueAtEndOfDayYmd("2026-07-01").toISOString()).toBe("2026-07-02T04:59:00.000Z");
    expect(dueAtEndOfDayYmd("2026-01-01").toISOString()).toBe("2026-01-02T05:59:00.000Z");
  });
});
