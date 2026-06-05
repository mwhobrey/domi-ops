import { describe, expect, it } from "vitest";
import { importedStubEmail, isImportedStubEmail, slugLegacyName } from "./imported-stub.js";

describe("imported stub email", () => {
  it("builds deterministic placeholder emails", () => {
    expect(importedStubEmail("Mom", "1")).toBe("mom-1@imported.local");
    expect(slugLegacyName("Kid #2")).toBe("kid-2");
  });

  it("detects imported.local stubs", () => {
    expect(isImportedStubEmail("mom-1@imported.local")).toBe(true);
    expect(isImportedStubEmail("real@gmail.com")).toBe(false);
  });
});
