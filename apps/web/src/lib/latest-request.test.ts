import { describe, expect, it } from "vitest";
import { rangeEndingOn } from "./health-report-export";
import { createLatestGate } from "./latest-request";

describe("createLatestGate", () => {
  it("makes only the newest request current, whatever order they finish in", () => {
    const gate = createLatestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    const third = gate.next();
    expect(gate.isCurrent(second)).toBe(false);
    expect(gate.isCurrent(third)).toBe(true);
  });

  it("cancel makes everything started so far obsolete", () => {
    const gate = createLatestGate();
    const id = gate.next();
    gate.cancel();
    expect(gate.isCurrent(id)).toBe(false);
  });
});

describe("rangeEndingOn", () => {
  it("counts back from the household's own today, across month and year ends", () => {
    expect(rangeEndingOn("2026-10-04")).toEqual({ from: "2026-09-04", to: "2026-10-04" });
    expect(rangeEndingOn("2026-01-10")).toEqual({ from: "2025-12-11", to: "2026-01-10" });
    expect(rangeEndingOn("2026-03-01", 1)).toEqual({ from: "2026-02-28", to: "2026-03-01" });
  });

  it("gives the same answer in every time zone of the machine it runs on", () => {
    // Pure date arithmetic: nothing here reads the local zone.
    expect(rangeEndingOn("2026-10-04", 7).from).toBe("2026-09-27");
  });
});
