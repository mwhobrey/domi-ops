import { describe, expect, it } from "vitest";
import type { Env } from "@domi-ops/config";
import { buildActivityTrend } from "./health-activity-trend.js";

// Values that do not start with "enc:v1:" pass through the health decryptor untouched.
const env = {} as Env;
const labels = new Map([
  ["m1", "Ally"],
  ["m2", "Ben"],
]);
const row = (over: Record<string, unknown> = {}) =>
  ({
    householdId: "h",
    memberId: "m1",
    withingsUserId: "u",
    date: "2026-10-01",
    deviceKey: "watch",
    isTracker: true,
    steps: "8000",
    distanceM: "6000",
    activeMinutes: "40",
    caloriesActive: "300",
    caloriesTotal: "2100",
    sourceModified: 1,
    updatedAt: new Date(),
    ...over,
  }) as Parameters<typeof buildActivityTrend>[0][number];

describe("buildActivityTrend", () => {
  it("turns a day into whole numbers and kilometres", () => {
    const [entry] = buildActivityTrend([row()], labels, env);
    expect(entry).toEqual({
      memberId: "m1",
      memberLabel: "Ally",
      points: [{ date: "2026-10-01", steps: 8000, distanceKm: 6, activeMinutes: 40, caloriesActive: 300 }],
    });
  });

  it("counts a day once: the tracker over the phone, then the most steps", () => {
    const phoneBigger = row({ deviceKey: "phone", isTracker: false, steps: "12000" });
    const [watchWins] = buildActivityTrend([phoneBigger, row()], labels, env);
    expect(watchWins!.points).toHaveLength(1);
    expect(watchWins!.points[0]!.steps).toBe(8000);

    const [mostSteps] = buildActivityTrend(
      [row({ deviceKey: "a", isTracker: false, steps: "100" }), row({ deviceKey: "b", isTracker: false, steps: "900" })],
      labels,
      env,
    );
    expect(mostSteps!.points[0]!.steps).toBe(900);
  });

  it("keeps people apart, sorts by name then date, and skips a day with no step count", () => {
    const entries = buildActivityTrend(
      [
        row({ memberId: "m2", date: "2026-10-02" }),
        row({ date: "2026-10-02" }),
        row({ date: "2026-10-01" }),
        row({ date: "2026-10-03", steps: null }),
      ],
      labels,
      env,
    );
    expect(entries.map((e) => e.memberLabel)).toEqual(["Ally", "Ben"]);
    expect(entries[0]!.points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("leaves out optional numbers it does not have", () => {
    const [entry] = buildActivityTrend([row({ distanceM: null, activeMinutes: null, caloriesActive: null })], labels, env);
    expect(entry!.points[0]).toEqual({ date: "2026-10-01", steps: 8000, distanceKm: null, activeMinutes: null, caloriesActive: null });
  });
});
