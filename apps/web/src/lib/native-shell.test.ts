import { describe, expect, it } from "vitest";
import { isNativeShell, nativePlatform } from "./native-shell";

describe("native-shell", () => {
  it("reports web when Capacitor is absent", () => {
    expect(isNativeShell()).toBe(false);
    expect(nativePlatform()).toBe("web");
  });
});
