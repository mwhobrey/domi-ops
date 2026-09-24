import { describe, expect, it } from "vitest";
import { excludeInactiveInstants } from "./health-med-pauses.js";

const d = (iso: string) => new Date(iso);
const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((day) =>
  d(`${day}T13:00:00.000Z`),
);

describe("excludeInactiveInstants", () => {
  it("keeps everything with no pauses and no deletion", () => {
    expect(excludeInactiveInstants(days, [], null)).toHaveLength(5);
  });

  it("drops doses inside a closed pause, resume instant included back", () => {
    const kept = excludeInactiveInstants(
      days,
      [{ pausedAt: d("2026-09-02T00:00:00.000Z"), resumedAt: d("2026-09-04T13:00:00.000Z") }],
      null,
    );
    expect(kept.map((i) => i.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("drops everything after an open pause (still paused)", () => {
    const kept = excludeInactiveInstants(days, [{ pausedAt: d("2026-09-03T00:00:00.000Z"), resumedAt: null }], null);
    expect(kept).toHaveLength(2);
  });

  it("handles on/off cycles and deletion together", () => {
    const kept = excludeInactiveInstants(
      days,
      [{ pausedAt: d("2026-09-01T12:00:00.000Z"), resumedAt: d("2026-09-02T12:00:00.000Z") }],
      d("2026-09-05T00:00:00.000Z"),
    );
    expect(kept.map((i) => i.toISOString().slice(0, 10))).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });
});
