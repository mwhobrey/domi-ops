import { describe, expect, it } from "vitest";
import {
  applyVisibleReorder,
  availableDashboardCards,
  DEFAULT_DASHBOARD_LAYOUT,
  hydrateDashboardLayout,
  mergeDashboardLayout,
  resolveDashboardSpan,
  spanFromResize,
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
    expect(hydrateDashboardLayout(null).cards).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(hydrateDashboardLayout(null).columns).toBe(2);
    expect(hydrateDashboardLayout({ cards: null }).cards).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(hydrateDashboardLayout([]).cards).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it("accepts a WHO-313 card-id array as columns=2 with no span overrides", () => {
    const state = hydrateDashboardLayout(["month", "glance"]);
    expect(state.columns).toBe(2);
    expect(state.cards[0]).toBe("month");
    expect(state.spans).toEqual({});
  });

  it("accepts the v2 object and clamps unknown columns", () => {
    const state = hydrateDashboardLayout({
      cards: ["household", "glance"],
      columns: 3,
      spans: { glance: 2, nope: 3, household: 1 },
    });
    expect(state.columns).toBe(3);
    expect(state.spans).toEqual({ glance: 2, household: 1 });
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
    const full = hydrateDashboardLayout(null).cards;
    const visible = visibleDashboardLayout(
      full,
      availableDashboardCards({ calendarModuleEnabled: false }),
    );
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

describe("resolveDashboardSpan", () => {
  it("defaults glance to a full row and agenda/weather to one column", () => {
    expect(resolveDashboardSpan("glance", 2, {})).toBe(2);
    expect(resolveDashboardSpan("agenda", 2, {})).toBe(1);
    expect(resolveDashboardSpan("weather", 3, {})).toBe(1);
    expect(resolveDashboardSpan("household", 3, {})).toBe(3);
  });

  it("clamps a stored span when the grid has fewer columns", () => {
    expect(resolveDashboardSpan("glance", 2, { glance: 3 })).toBe(2);
    expect(resolveDashboardSpan("agenda", 3, { agenda: 2 })).toBe(2);
  });
});

describe("spanFromResize", () => {
  it("snaps the pointer to a column count", () => {
    // 2-col grid, 200px wide, 24px gap → col = 88. Pointer at left+88 → 1 col; past midpoint+gap → 2.
    expect(spanFromResize(0, 0, 200, 2, 24)).toBe(1);
    expect(spanFromResize(200, 0, 200, 2, 24)).toBe(2);
    expect(spanFromResize(400, 0, 400, 3, 24)).toBe(3);
  });
});
