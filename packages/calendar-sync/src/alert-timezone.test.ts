import { describe, expect, it } from "vitest";
import { isValidTimeZone, resolveAlertTimeZone } from "./alert-timezone.js";
import { zonedLocalToUtc } from "./household-time.js";

describe("resolveAlertTimeZone", () => {
  it("prefers device over household", () => {
    expect(
      resolveAlertTimeZone({
        deviceTimezone: "America/New_York",
        householdTimezone: "America/Chicago",
      }),
    ).toBe("America/New_York");
  });

  it("falls back to household then UTC", () => {
    expect(resolveAlertTimeZone({ householdTimezone: "America/Chicago" })).toBe("America/Chicago");
    expect(resolveAlertTimeZone({})).toBe("UTC");
    expect(resolveAlertTimeZone({ deviceTimezone: "Not/AZone", householdTimezone: null })).toBe(
      "UTC",
    );
  });

  it("rejects invalid IANA", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Foo/Bar")).toBe(false);
  });
});

describe("per-device dose instants", () => {
  it("same wall-clock maps to different UTC by device TZ", () => {
    const date = "2026-08-05";
    const eastern = zonedLocalToUtc(date, "08:00", "America/New_York");
    const central = zonedLocalToUtc(date, "08:00", "America/Chicago");
    expect(eastern.toISOString()).toBe("2026-08-05T12:00:00.000Z");
    expect(central.toISOString()).toBe("2026-08-05T13:00:00.000Z");
  });
});
