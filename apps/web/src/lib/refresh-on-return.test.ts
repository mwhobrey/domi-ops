import { describe, expect, it } from "vitest";
import { shouldRefreshOnReturn, STALE_AFTER_MS } from "./refresh-on-return";

describe("shouldRefreshOnReturn", () => {
  it("refreshes after being away long enough", () => {
    expect(shouldRefreshOnReturn({ awayMs: STALE_AFTER_MS, busy: false })).toBe(true);
    expect(shouldRefreshOnReturn({ awayMs: STALE_AFTER_MS * 10, busy: false })).toBe(true);
  });

  it("ignores quick tab flips", () => {
    expect(shouldRefreshOnReturn({ awayMs: STALE_AFTER_MS - 1, busy: false })).toBe(false);
  });

  it("does nothing when we never saw the tab leave", () => {
    expect(shouldRefreshOnReturn({ awayMs: null, busy: false })).toBe(false);
  });

  it("never refreshes over unsaved work", () => {
    expect(shouldRefreshOnReturn({ awayMs: STALE_AFTER_MS * 10, busy: true })).toBe(false);
  });
});
