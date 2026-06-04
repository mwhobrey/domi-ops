import { describe, expect, it } from "vitest";
import { normalizePresence, normalizeStatusMessage, serializeHomeStatus } from "./home-status.js";

describe("home-status", () => {
  it("normalizes presence", () => {
    expect(normalizePresence("Home")).toBe("Home");
    expect(normalizePresence("away")).toBe("Away");
    expect(normalizePresence(undefined)).toBe("Away");
  });

  it("normalizes status message", () => {
    expect(normalizeStatusMessage("  At work  ")).toBe("At work");
    expect(normalizeStatusMessage("   ")).toBeNull();
  });

  it("serializes row", () => {
    expect(
      serializeHomeStatus({ presence: "Home", statusMessage: "Cooking" }),
    ).toEqual({ presence: "Home", statusMessage: "Cooking" });
  });
});
