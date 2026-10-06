import { describe, expect, it } from "vitest";
import { dropNodeProcessWarnings, isNodeProcessWarning } from "./sentry-filters";

const MAX_LISTENERS =
  "(node:1) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added to [ServerResponse]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit";

describe("web sentry filter (copy of packages/config)", () => {
  it("drops Node process warnings wherever the text sits", () => {
    expect(isNodeProcessWarning(MAX_LISTENERS)).toBe(true);
    expect(dropNodeProcessWarnings({ message: MAX_LISTENERS })).toBeNull();
    expect(dropNodeProcessWarnings({ exception: { values: [{ value: MAX_LISTENERS }] } })).toBeNull();
  });

  it("keeps real errors untouched", () => {
    const real = { message: "Error: boom" };
    expect(dropNodeProcessWarnings(real)).toBe(real);
    expect(isNodeProcessWarning("Failed: (node:1) MaxListenersExceededWarning: x")).toBe(false);
  });
});
