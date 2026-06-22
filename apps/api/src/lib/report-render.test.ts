import { describe, expect, it } from "vitest";
import {
  renderWeeklyReportPlain,
  renderWeeklyReportStyledHtml,
  renderWeeklyReportsCombinedPlain,
} from "./report-render.js";
import type { WeeklyReportData } from "./weekly-reports/types.js";

const sample: WeeklyReportData = {
  module: "school",
  variant: "by-subject",
  variantLabel: "By subject",
  title: "School weekly schedule (By subject) — Jun 15–19, 2026",
  weekStart: "2026-06-15",
  weekEnd: "2026-06-19",
  weekLabel: "Jun 15–19, 2026",
  timezone: "UTC",
  groups: [
    {
      key: "math",
      label: "Math",
      items: [
        {
          id: "a1",
          title: "Quiz 3",
          subtitle: "Algebra",
          dueDate: "2026-06-17",
          dueLabel: "Wed, Jun 17",
        },
      ],
    },
  ],
  totalItems: 1,
};

describe("report-render", () => {
  it("renders plain text with group and item", () => {
    const text = renderWeeklyReportPlain(sample);
    expect(text).toContain("Math");
    expect(text).toContain("Quiz 3");
    expect(text).toContain("Wed, Jun 17");
  });

  it("renders styled html table", () => {
    const html = renderWeeklyReportStyledHtml(sample);
    expect(html).toContain("<table");
    expect(html).toContain("Quiz 3");
  });

  it("combines multiple weeks in plain text", () => {
    const second = { ...sample, weekStart: "2026-06-22", weekLabel: "Jun 22–26, 2026", title: "Week 2" };
    const text = renderWeeklyReportsCombinedPlain([sample, second], "Range export");
    expect(text).toContain("Range export");
    expect(text).toContain("Week of Jun 22–26, 2026");
    expect(text).toContain("Quiz 3");
  });

  it("omits redundant due column for by-day grouping", () => {
    const byDay: WeeklyReportData = {
      ...sample,
      variant: "by-day",
      variantLabel: "By day",
      groups: [
        {
          key: "2026-06-17",
          label: "Wednesday, Jun 17",
          items: [
            {
              id: "a1",
              title: "Quiz 3",
              subtitle: "Algebra",
              dueDate: "2026-06-17",
              dueLabel: "Wed, Jun 17",
            },
          ],
        },
      ],
    };
    const text = renderWeeklyReportPlain(byDay);
    expect(text).toContain("Wednesday, Jun 17");
    expect(text).toContain("Quiz 3");
    expect(text).not.toContain("Wed, Jun 17");

    const html = renderWeeklyReportStyledHtml(byDay);
    expect(html).not.toContain("<th>Due</th>");
  });
});
