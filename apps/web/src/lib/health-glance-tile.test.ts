import { describe, expect, it } from "vitest";
import { buildHealthTile, type HealthGlance } from "./health-glance-tile";

const NOW = Date.parse("2026-10-03T15:00:00.000Z");
const iso = (hhmm: string) => `2026-10-03T${hhmm}:00.000Z`;

const dose = (hhmm: string, over: Record<string, unknown> = {}) => ({
  medicationId: `med-${hhmm}`,
  name: "Vitamin",
  dosage: "1 tablet",
  scheduledAt: iso(hhmm),
  scheduledTimeLabel: hhmm,
  ...over,
});
const check = (hhmm: string, status: "upcoming" | "due" | "overdue", over: Record<string, unknown> = {}) => ({
  checkId: `chk-${hhmm}`,
  name: "BP",
  scheduledAt: iso(hhmm),
  scheduledTimeLabel: hhmm,
  status,
  ...over,
});

describe("buildHealthTile", () => {
  it("is nothing without a glance", () => {
    expect(buildHealthTile(null, NOW)).toBeNull();
  });

  describe("doses only (unchanged)", () => {
    it("is all clear when nothing is pending", () => {
      const tile = buildHealthTile({ pendingDoses: [] }, NOW)!;
      expect(tile).toMatchObject({ headline: "All clear", tone: "success", emptyHint: "No doses pending today.", items: [] });
    });

    it("counts doses, and turns to overdue once a dose time has passed", () => {
      expect(buildHealthTile({ pendingDoses: [dose("16:00"), dose("17:00")] }, NOW)).toMatchObject({
        headline: "2 doses",
        tone: "default",
      });
      expect(buildHealthTile({ pendingDoses: [dose("14:00"), dose("17:00")] }, NOW)).toMatchObject({
        headline: "1 overdue",
        tone: "warning",
      });
      expect(buildHealthTile({ pendingDoses: [dose("16:00")] }, NOW)!.headline).toBe("1 dose");
    });

    it("leaves an interval dose waiting for its first dose out of overdue", () => {
      const tile = buildHealthTile({ pendingDoses: [dose("09:00", { awaitingFirst: true })] }, NOW)!;
      expect(tile.headline).toBe("1 dose");
      expect(tile.items[0]!.meta).toContain("Start");
    });
  });

  describe("scheduled checks", () => {
    it("counts checks on their own as checks", () => {
      const tile = buildHealthTile({ pendingChecks: [check("16:00", "upcoming"), check("20:00", "upcoming")] }, NOW)!;
      expect(tile).toMatchObject({ headline: "2 checks", tone: "default" });
      expect(buildHealthTile({ pendingChecks: [check("16:00", "upcoming")] }, NOW)!.headline).toBe("1 check");
    });

    it("says to do when doses and checks are both waiting", () => {
      const tile = buildHealthTile({ pendingDoses: [dose("16:00")], pendingChecks: [check("20:00", "upcoming")] }, NOW)!;
      expect(tile.headline).toBe("2 to do");
    });

    it("warns for an overdue check, but not for one that has only just come due", () => {
      expect(buildHealthTile({ pendingChecks: [check("14:00", "overdue")] }, NOW)).toMatchObject({
        headline: "1 overdue",
        tone: "warning",
      });
      // The time has passed but it is inside the half hour a reading is expected to be taken in.
      const due = buildHealthTile({ pendingChecks: [check("14:50", "due")] }, NOW)!;
      expect(due).toMatchObject({ headline: "1 check", tone: "default" });
      expect(due.items[0]!.meta).toBe("14:50");
    });

    it("shows overdue checks in the item meta like late doses", () => {
      const tile = buildHealthTile({ pendingChecks: [check("13:00", "overdue")] }, NOW)!;
      expect(tile.items[0]).toMatchObject({ label: "BP", meta: "Overdue", href: `/health?check=chk-13%3A00&scheduledAt=${encodeURIComponent(iso("13:00"))}` });
    });

    it("names whose check it is when it isn't yours", () => {
      const tile = buildHealthTile(
        { pendingChecks: [check("16:00", "upcoming", { memberLabel: "Ally Rivera", isSelf: false })] },
        NOW,
      )!;
      expect(tile.items[0]!.label).toBe("BP · Ally");
    });

    it("orders doses and checks together by time and keeps three, counting the rest", () => {
      const glance: HealthGlance = {
        pendingDoses: [dose("18:00")],
        pendingChecks: [check("16:00", "upcoming"), check("17:00", "upcoming"), check("19:00", "upcoming")],
      };
      const tile = buildHealthTile(glance, NOW)!;
      expect(tile.items.map((i) => i.meta)).toEqual(["16:00", "17:00", "18:00 · 1 tablet"]);
      expect(tile.overflowCount).toBe(1);
    });

    it("reports progress when everything is done", () => {
      const tile = buildHealthTile({ pendingDoses: [], pendingChecks: [], checkProgress: { done: 4, total: 4 } }, NOW)!;
      expect(tile).toMatchObject({ headline: "All clear", tone: "success", emptyHint: "4 of 4 checks done today." });
    });

    it("keeps the dose hint when there are no checks today", () => {
      const tile = buildHealthTile({ pendingChecks: [], checkProgress: { done: 0, total: 0 } }, NOW)!;
      expect(tile.emptyHint).toBe("No doses pending today.");
    });
  });
});
