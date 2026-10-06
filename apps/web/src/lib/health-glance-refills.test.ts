import { describe, expect, it } from "vitest";
import { buildHealthTile, type HealthGlance } from "./health-glance-tile";

const NOW = Date.parse("2026-10-03T15:00:00.000Z");
const dose = (hhmm: string) => ({
  medicationId: `med-${hhmm}`,
  name: "Vitamin",
  dosage: "1 tablet",
  scheduledAt: `2026-10-03T${hhmm}:00.000Z`,
  scheduledTimeLabel: hhmm,
});
const refill = (id: string, over: Record<string, unknown> = {}) => ({
  medicationId: id,
  name: `Med ${id}`,
  runsOutOn: "2026-10-08",
  daysRemaining: 5,
  overdue: false,
  ...over,
});

describe("buildHealthTile refills", () => {
  it("is unchanged without refills", () => {
    expect(buildHealthTile({ pendingDoses: [], refillsDue: [] }, NOW)).toMatchObject({ headline: "All clear", tone: "success", items: [] });
  });

  it("says refills are due when nothing else is waiting, and links each to its supply", () => {
    const tile = buildHealthTile({ refillsDue: [refill("a"), refill("b", { overdue: true, runsOutOn: "2026-10-04" })] } as HealthGlance, NOW)!;
    expect(tile).toMatchObject({ headline: "2 refills due", tone: "warning", overflowCount: 0, emptyHint: undefined });
    expect(tile.items.map((i) => [i.label, i.meta, i.href])).toEqual([
      ["Refill Med a", "Due · runs out Oct 8", "/health?supply=a"],
      ["Refill Med b", "Overdue · runs out Oct 4", "/health?supply=b"],
    ]);
  });

  it("uses the singular for one", () => {
    expect(buildHealthTile({ refillsDue: [refill("a")] } as HealthGlance, NOW)).toMatchObject({ headline: "1 refill due" });
  });

  it("adds them to the headline after what is waiting today, without changing its tone", () => {
    const tile = buildHealthTile({ pendingDoses: [dose("16:00")], refillsDue: [refill("a")] } as HealthGlance, NOW)!;
    expect(tile).toMatchObject({ headline: "1 dose · 1 refill", tone: "default" });
    expect(tile.items.map((i) => i.key)).toEqual(["med-16:00-2026-10-03T16:00:00.000Z", "refill:a"]);
  });

  it("shows doses first, fills the rest of the three lines with refills and counts what is left over", () => {
    const tile = buildHealthTile(
      { pendingDoses: [dose("16:00"), dose("17:00")], refillsDue: [refill("a"), refill("b"), refill("c")] } as HealthGlance,
      NOW,
    )!;
    expect(tile.items.map((i) => (i.href ?? "").startsWith("/health?supply="))).toEqual([false, false, true]);
    expect(tile.overflowCount).toBe(2);
  });

  it("names whose refill it is when it is not yours", () => {
    const tile = buildHealthTile({ refillsDue: [refill("a", { memberLabel: "Ally Rivera", isSelf: false })] } as HealthGlance, NOW)!;
    expect(tile.items[0]!.label).toBe("Refill Med a · Ally");
  });
});
