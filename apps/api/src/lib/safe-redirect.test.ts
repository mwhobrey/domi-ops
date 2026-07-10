import { describe, expect, it } from "vitest";
import { safeAppRedirectPath } from "./safe-redirect.js";

describe("safeAppRedirectPath", () => {
  it("allows relative paths", () => {
    expect(safeAppRedirectPath("/school/class/abc")).toBe("/school/class/abc");
    expect(safeAppRedirectPath("/profile?tab=integrations")).toBe("/profile?tab=integrations");
  });

  it("rejects open redirects", () => {
    expect(safeAppRedirectPath("https://evil.com")).toBeNull();
    expect(safeAppRedirectPath("//evil.com")).toBeNull();
    expect(safeAppRedirectPath("")).toBeNull();
  });
});
