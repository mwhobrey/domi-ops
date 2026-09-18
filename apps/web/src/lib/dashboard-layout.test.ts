import { describe, expect, it } from "vitest";
import {
  applyVisibleReorder,
  availableDashboardCards,
  dashboardCardSpan,
  DEFAULT_DASHBOARD_LAYOUT,
  hydrateDashboardLayout,
  mergeDashboardLayout,
  visibleDashboardLayout,
  type DashboardCardId,
} from "./dashboard-layout";

describe("mergeDashboardLayout", () => {
  it("drops unknown ids, dedupes, and appends missing known cards", () => {
    expect(mergeDashboardLayout(["month", "glance", "nope", "glance"])).toEqual([
      "month",
      "glance",
      "agenda",
      "weather",
      "conflicts",
      "household",
    ]);
  });
});

describe("hydrateDashboardLayout", () => {
  it("returns the default when nothing is saved", () => {
    expect(hydrateDashboardLayout(null)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(hydrateDashboardLayout([])).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });
});

describe("visibleDashboardLayout", () => {
  it("omits the conflict checker when calendar is off", () => {
    const available = availableDashboardCards({ calendarModuleEnabled: false });
    expect(visibleDashboardLayout(DEFAULT_DASHBOARD_LAYOUT, available)).toEqual([
      "glance",
      "agenda",
      "weather",
      "household",
      "month",
    ]);
  });
});

describe("applyVisibleReorder", () => {
  it("keeps a gated card in its slot while visible cards move around it", () => {
    const full = hydrateDashboardLayout(null);
    const visible = visibleDashboardLayout(
      full,
      availableDashboardCards({ calendarModuleEnabled: false }),
    );
    // Move household to the top of the visible list.
    const nextVisible: DashboardCardId[] = ["household", ...visible.filter((id) => id !== "household")];
    expect(applyVisibleReorder(full, nextVisible)).toEqual([
      "household",
      "glance",
      "agenda",
      "conflicts",
      "weather",
      "month",
    ]);
  });
});

describe("dashboardCardSpan", () => {
  it("pairs agenda and weather when they sit next to each other", () => {
    const visible = ["glance", "agenda", "weather", "household"] as const;
    expect(dashboardCardSpan("glance", visible)).toBe("full");
    expect(dashboardCardSpan("agenda", visible)).toBe("half");
    expect(dashboardCardSpan("weather", visible)).toBe("half");
    expect(dashboardCardSpan("household", visible)).toBe("full");
  });

  it("stretches an orphan half-span card to full width", () => {
    const visible = ["weather", "household", "agenda"] as const;
    expect(dashboardCardSpan("weather", visible)).toBe("full");
    expect(dashboardCardSpan("agenda", visible)).toBe("full");
  });
});
