import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  buildExpenseReportFromData,
  currentMonthKey,
  monthKeysEndingAt,
  normalizeExpenseCategory,
  normalizeMonthKey,
  UNCATEGORIZED_LABEL,
  type BudgetSummary,
} from "./expenses.js";

describe("normalizeExpenseCategory", () => {
  it("trims and caps category", () => {
    expect(normalizeExpenseCategory("  Groceries  ")).toBe("Groceries");
    expect(normalizeExpenseCategory("")).toBeNull();
    expect(normalizeExpenseCategory(null)).toBeNull();
  });
});

describe("budgetStatus", () => {
  it("classifies spend against target", () => {
    expect(budgetStatus(50, 100)).toBe("under");
    expect(budgetStatus(80, 100)).toBe("warning");
    expect(budgetStatus(100, 100)).toBe("over");
    expect(budgetStatus(120, 100)).toBe("over");
  });
});

describe("currentMonthKey", () => {
  it("formats YYYY-MM", () => {
    expect(currentMonthKey(new Date("2026-06-08"))).toBe("2026-06");
  });
});

describe("normalizeMonthKey", () => {
  it("accepts valid months and rejects junk", () => {
    expect(normalizeMonthKey("2026-06")).toBe("2026-06");
    expect(normalizeMonthKey("2026-13")).toBeNull();
    expect(normalizeMonthKey("nope")).toBeNull();
  });
});

describe("monthKeysEndingAt", () => {
  it("returns consecutive months ending at the given key", () => {
    expect(monthKeysEndingAt("2026-03", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthKeysEndingAt("2026-01", 2)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("buildExpenseReportFromData", () => {
  const budgets: BudgetSummary[] = [
    {
      id: "b1",
      category: "Groceries",
      monthlyTarget: 400,
      monthSpend: 0,
      percentUsed: 0,
      status: "under",
      memberId: null,
      scope: "household",
      shareAccess: null,
      shares: [],
    },
    {
      id: "b2",
      category: "Gas",
      monthlyTarget: 100,
      monthSpend: 0,
      percentUsed: 0,
      status: "under",
      memberId: null,
      scope: "household",
      shareAccess: null,
      shares: [],
    },
  ];

  it("aggregates month spend, categories, trend, and health", () => {
    const report = buildExpenseReportFromData(
      [
        {
          id: "e1",
          title: "Store run",
          amount: 120,
          category: "Groceries",
          expenseDate: "2026-06-05",
          memberId: null,
          createdByDisplayName: null,
        },
        {
          id: "e2",
          title: "Fill-up",
          amount: 85,
          category: "Gas",
          expenseDate: "2026-06-10",
          memberId: null,
          createdByDisplayName: null,
        },
        {
          id: "e3",
          title: "Pizza",
          amount: 45,
          category: "Dining",
          expenseDate: "2026-06-12",
          memberId: null,
          createdByDisplayName: null,
        },
        {
          id: "e4",
          title: "April bill",
          amount: 50,
          category: "Utilities",
          expenseDate: "2026-04-15",
          memberId: null,
          createdByDisplayName: null,
        },
      ],
      budgets,
      "2026-06",
    );

    expect(report.monthSpend).toBe(250);
    expect(report.monthBudgeted).toBe(500);
    expect(report.percentUsed).toBe(50);
    expect(report.expenseCount).toBe(3);
    expect(report.topCategories[0]).toEqual({ category: "Groceries", spend: 120 });
    expect(report.budgetHealth.nearlyFull).toContain("Gas");
    expect(report.budgetHealth.unbudgeted).toContain("Dining");
    expect(report.monthlyTrend.find((row) => row.month === "2026-04")?.total).toBe(50);
    expect(report.recentBigSpends[0]?.title).toBe("Store run");
  });

  it("groups missing categories as uncategorized", () => {
    const report = buildExpenseReportFromData(
      [
        {
          id: "e1",
          title: "Cash",
          amount: 20,
          category: null,
          expenseDate: "2026-06-01",
          memberId: null,
          createdByDisplayName: null,
        },
      ],
      [],
      "2026-06",
    );

    expect(report.topCategories[0]?.category).toBe(UNCATEGORIZED_LABEL);
    expect(report.byCategory[0]?.category).toBe(UNCATEGORIZED_LABEL);
    expect(report.byCategory[0]?.status).toBe("unbudgeted");
  });
});
