import { describe, expect, it } from "vitest";
import { parseColor, relativeLuminance, textColorForBackground } from "./color-contrast";

describe("parseColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseColor("#fef08a")).toEqual({ r: 254, g: 240, b: 138 });
  });

  it("parses 3-digit hex", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("parses rgb()", () => {
    expect(parseColor("rgb(59, 130, 246)")).toEqual({ r: 59, g: 130, b: 246 });
  });

  it("returns null for unknown", () => {
    expect(parseColor("var(--color-accent)")).toBeNull();
  });
});

describe("textColorForBackground", () => {
  it("uses dark text on light yellow", () => {
    expect(textColorForBackground("#fef08a")).toBe("#0c0f14");
  });

  it("uses light text on blue", () => {
    expect(textColorForBackground("#3b82f6")).toBe("#f1f5f9");
  });

  it("defaults to light text for unparseable", () => {
    expect(textColorForBackground("not-a-color")).toBe("#f1f5f9");
  });
});

describe("relativeLuminance", () => {
  it("white is brighter than black", () => {
    expect(relativeLuminance(255, 255, 255)).toBeGreaterThan(relativeLuminance(0, 0, 0));
  });
});
