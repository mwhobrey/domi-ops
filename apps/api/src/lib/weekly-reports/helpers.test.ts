import { describe, expect, it } from "vitest";
import { groupItemsByDay, weekdayLongLabel } from "./helpers.js";
import type { WeeklyReportItem } from "./types.js";

describe("groupItemsByDay", () => {
  it("groups items by weekday within Mon–Fri and sorts chronologically", () => {
    const items: WeeklyReportItem[] = [
      { id: "b", title: "B", dueDate: "2026-06-17", dueLabel: "Wed" },
      { id: "a", title: "A", dueDate: "2026-06-15", dueLabel: "Mon" },
      { id: "c", title: "C", dueDate: "2026-06-17", dueLabel: "Wed" },
    ];
    const groups = groupItemsByDay(items, "2026-06-15", "2026-06-19");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe("2026-06-15");
    expect(groups[0]!.label).toBe(weekdayLongLabel("2026-06-15"));
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("skips items outside the week", () => {
    const items: WeeklyReportItem[] = [
      { id: "x", title: "Weekend", dueDate: "2026-06-14", dueLabel: "Sun" },
    ];
    const groups = groupItemsByDay(items, "2026-06-15", "2026-06-19");
    expect(groups).toHaveLength(0);
  });
});
