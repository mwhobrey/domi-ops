import { describe, expect, it } from "vitest";
import { normalizeMyallyfileLinkCode } from "./health-myallyfile.js";

describe("normalizeMyallyfileLinkCode", () => {
  it("accepts XXXX-XXXX, any case, with stray spaces", () => {
    expect(normalizeMyallyfileLinkCode("ab3d-7xyz")).toBe("AB3D7XYZ");
    expect(normalizeMyallyfileLinkCode("  AB3D 7XYZ ")).toBe("AB3D7XYZ");
    expect(normalizeMyallyfileLinkCode("AB3D7XYZ")).toBe("AB3D7XYZ");
  });

  it("rejects wrong length and the letters Crockford drops (I L O U)", () => {
    expect(normalizeMyallyfileLinkCode("AB3D-7XY")).toBeNull();
    expect(normalizeMyallyfileLinkCode("AB3D-7XYZZ")).toBeNull();
    for (const bad of ["I", "L", "O", "U"]) {
      expect(normalizeMyallyfileLinkCode(`AB3D-7XY${bad}`)).toBeNull();
    }
  });

  it("rejects non-strings", () => {
    expect(normalizeMyallyfileLinkCode(undefined)).toBeNull();
    expect(normalizeMyallyfileLinkCode(12345678)).toBeNull();
  });
});
