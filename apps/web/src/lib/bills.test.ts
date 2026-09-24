import { describe, expect, it } from "vitest";
import { billDueLabel, billIntervalLabel, sortBills, upcomingBillsTotal, type RecurringBill } from "./bills";

function bill(partial: Partial<RecurringBill>): RecurringBill {
  return {
    id: partial.title ?? "b",
    title: "Bill",
    amount: 10,
    category: null,
    memberId: null,
    interval: "monthly",
    anchorDate: "2026-09-01",
    nextAt: "2026-10-01",
    enabled: true,
    ...partial,
  };
}

describe("billDueLabel", () => {
  it("reads relative days up close and a date further out", () => {
    expect(billDueLabel("2026-09-23", "2026-09-23")).toBe("Due today");
    expect(billDueLabel("2026-09-24", "2026-09-23")).toBe("Due tomorrow");
    expect(billDueLabel("2026-10-01", "2026-09-23")).toBe("Due in 8 days");
    expect(billDueLabel("2026-10-31", "2026-09-23")).toBe("Due Oct 31");
    expect(billDueLabel("2027-01-05", "2026-09-23")).toBe("Due Jan 5, 2027");
  });
});

describe("billIntervalLabel", () => {
  it("labels intervals", () => {
    expect(billIntervalLabel("biweekly")).toBe("Every 2 weeks");
  });
});

describe("sortBills", () => {
  it("puts active bills by due date ahead of paused ones", () => {
    const sorted = sortBills([
      bill({ title: "Paused", enabled: false }),
      bill({ title: "Later", nextAt: "2026-10-20" }),
      bill({ title: "Sooner", nextAt: "2026-09-30" }),
    ]);
    expect(sorted.map((b) => b.title)).toEqual(["Sooner", "Later", "Paused"]);
  });
});

describe("upcomingBillsTotal", () => {
  it("sums active bills due in the window", () => {
    const bills = [
      bill({ title: "Rent", amount: 1200, nextAt: "2026-10-01" }),
      bill({ title: "Far", amount: 50, nextAt: "2026-11-15" }),
      bill({ title: "Paused", amount: 99, nextAt: "2026-09-30", enabled: false }),
    ];
    expect(upcomingBillsTotal(bills, "2026-09-23", 30)).toBe(1200);
  });
});
