export type GlanceTone = "default" | "warning" | "success";

export type BudgetGlanceRow = {
  id: string;
  category: string;
  percentUsed: number;
  status: "under" | "warning" | "over";
};

/** Worst-first: over budget, then near the limit, then everything else — mirrors chores-glance's
 *  "overdue, then due today, then the rest" ordering (lead with what needs attention). */
export function buildExpensesGlance(budgets: BudgetGlanceRow[]) {
  const overCount = budgets.filter((b) => b.status === "over").length;
  const warningCount = budgets.filter((b) => b.status === "warning").length;

  const rank = { over: 0, warning: 1, under: 2 } as const;
  const ordered = [...budgets].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.percentUsed - a.percentUsed,
  );
  const items = ordered.slice(0, 3).map((b) => ({
    id: b.id,
    category: b.category,
    percentUsed: b.percentUsed,
    status: b.status,
  }));
  const overflow = Math.max(0, ordered.length - 3);

  let headline: string;
  let tone: GlanceTone;
  if (budgets.length === 0) {
    headline = "Set up";
    tone = "default";
  } else if (overCount > 0) {
    headline = `${overCount} over budget`;
    tone = "warning";
  } else if (warningCount > 0) {
    headline = `${warningCount} near limit`;
    tone = "default";
  } else {
    headline = "On track";
    tone = "success";
  }

  return { summary: { headline, tone }, items, overflow };
}
