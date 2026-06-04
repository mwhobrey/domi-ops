import { describe, expect, it } from "vitest";
import { parseRrule } from "./recurring.js";

describe("parseRrule", () => {
  it("parses weekly with until", () => {
    const p = parseRrule("FREQ=WEEKLY;BYDAY=MO;INTERVAL=1;UNTIL=20261231");
    expect(p?.freq).toBe("WEEKLY");
    expect(p?.until).toBe("2026-12-31");
  });

  it("parses monthly", () => {
    expect(parseRrule("FREQ=MONTHLY;INTERVAL=2")?.freq).toBe("MONTHLY");
  });
});
