import { describe, expect, it } from "vitest";
import {
  billDateAt,
  dueBillDates,
  MAX_BILL_CATCH_UP,
  nextBillDateOnOrAfter,
  normalizeBillInterval,
} from "./expense-recurring.js";

describe("billDateAt", () => {
  it("keeps a bill on the 31st after short months", () => {
    expect([0, 1, 2, 3].map((k) => billDateAt("monthly", "2026-01-31", k))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("steps weekly, biweekly, quarterly, and yearly", () => {
    expect(billDateAt("weekly", "2026-12-28", 1)).toBe("2027-01-04");
    expect(billDateAt("biweekly", "2026-09-04", 2)).toBe("2026-10-02");
    expect(billDateAt("quarterly", "2026-11-15", 1)).toBe("2027-02-15");
    expect(billDateAt("yearly", "2028-02-29", 1)).toBe("2029-02-28");
    expect(billDateAt("yearly", "2028-02-29", 4)).toBe("2032-02-29");
  });
});

describe("nextBillDateOnOrAfter", () => {
  it("returns the anchor when it's today or later", () => {
    expect(nextBillDateOnOrAfter("monthly", "2026-10-01", "2026-09-23")).toBe("2026-10-01");
    expect(nextBillDateOnOrAfter("monthly", "2026-09-23", "2026-09-23")).toBe("2026-09-23");
  });

  it("skips past dates instead of back-filling them", () => {
    expect(nextBillDateOnOrAfter("monthly", "2026-01-01", "2026-09-23")).toBe("2026-10-01");
  });
});

describe("dueBillDates", () => {
  it("posts each missed date once and schedules the next", () => {
    expect(dueBillDates("weekly", "2026-09-01", "2026-09-08", "2026-09-23")).toEqual({
      dates: ["2026-09-08", "2026-09-15", "2026-09-22"],
      nextAt: "2026-09-29",
    });
  });

  it("posts nothing before the first due date", () => {
    expect(dueBillDates("monthly", "2026-10-01", "2026-10-01", "2026-09-23")).toEqual({
      dates: [],
      nextAt: "2026-10-01",
    });
  });

  it("caps a long catch-up to the most recent dates", () => {
    const { dates, nextAt } = dueBillDates("weekly", "2020-01-06", "2020-01-06", "2026-09-23");
    expect(dates).toHaveLength(MAX_BILL_CATCH_UP);
    expect(dates.at(-1)).toBe("2026-09-21");
    expect(nextAt).toBe("2026-09-28");
  });
});

describe("normalizeBillInterval", () => {
  it("accepts known intervals only", () => {
    expect(normalizeBillInterval("quarterly")).toBe("quarterly");
    expect(normalizeBillInterval("daily")).toBeNull();
  });
});
