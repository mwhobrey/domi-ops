import { describe, expect, it } from "vitest";
import type { Env } from "@domi-ops/config";
import { buildSleepTrend } from "./health-sleep-trend.js";

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
    sleepId: "1",
    date: "2026-10-01",
    startedAt: new Date("2026-10-01T05:00:00Z"),
    endedAt: new Date("2026-10-01T13:00:00Z"),
    totalSleepMinutes: "420",
    inBedMinutes: "480",
    lightMinutes: "240",
    deepMinutes: "90",
    remMinutes: "90",
    awakeMinutes: "60",
    wakeCount: "2",
    sleepScore: "81",
    sourceModified: 1,
    updatedAt: new Date(),
    ...over,
  }) as Parameters<typeof buildSleepTrend>[0][number];

describe("buildSleepTrend", () => {
  it("returns the night's minutes, stages and score", () => {
    const [entry] = buildSleepTrend([row()], labels, env);
    expect(entry).toEqual({
      memberId: "m1",
      memberLabel: "Ally",
      points: [
        { date: "2026-10-01", totalMinutes: 420, inBedMinutes: 480, lightMinutes: 240, deepMinutes: 90, remMinutes: 90, awakeMinutes: 60, score: 81 },
      ],
    });
  });

  it("shows a date once, with its longest sleep, rather than adding a nap or a second device", () => {
    const [entry] = buildSleepTrend([row({ sleepId: "nap", totalSleepMinutes: "45" }), row({ sleepId: "night" }), row({ sleepId: "mat", totalSleepMinutes: "400" })], labels, env);
    expect(entry!.points).toHaveLength(1);
    expect(entry!.points[0]!.totalMinutes).toBe(420);
  });

  it("skips a night with no total, keeps people apart and sorts them", () => {
    const entries = buildSleepTrend(
      [row({ memberId: "m2" }), row(), row({ date: "2026-10-02" }), row({ date: "2026-10-03", totalSleepMinutes: null, sleepId: "x" })],
      labels,
      env,
    );
    expect(entries.map((e) => e.memberLabel)).toEqual(["Ally", "Ben"]);
    expect(entries[0]!.points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("leaves out stage numbers an outside source does not give", () => {
    const [entry] = buildSleepTrend([row({ lightMinutes: null, deepMinutes: null, remMinutes: null, sleepScore: null })], labels, env);
    expect(entry!.points[0]).toMatchObject({ lightMinutes: null, deepMinutes: null, remMinutes: null, score: null });
  });
});
