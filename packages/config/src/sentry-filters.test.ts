import { describe, expect, it } from "vitest";
import { dropNodeProcessWarnings, isNodeProcessWarning } from "./sentry-filters.js";

const MAX_LISTENERS =
  "(node:1) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added to [ServerResponse]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit";

describe("isNodeProcessWarning", () => {
  it("recognises Node's warning lines, whatever the kind or process id", () => {
    expect(isNodeProcessWarning(MAX_LISTENERS)).toBe(true);
    expect(isNodeProcessWarning("(node:64152) DeprecationWarning: Buffer() is deprecated")).toBe(true);
    expect(isNodeProcessWarning("(node:7) ExperimentalWarning: stuff")).toBe(true);
    expect(isNodeProcessWarning("(node:7) Warning: plain")).toBe(true);
  });

  it("does not match real errors, other text, or a warning mentioned in the middle of a message", () => {
    expect(isNodeProcessWarning("Error: connect ECONNREFUSED")).toBe(false);
    expect(isNodeProcessWarning("Failed to send reminder: (node:1) MaxListenersExceededWarning: x")).toBe(false);
    expect(isNodeProcessWarning("(node:1) Error: boom")).toBe(false);
    expect(isNodeProcessWarning("")).toBe(false);
    expect(isNodeProcessWarning(undefined)).toBe(false);
    expect(isNodeProcessWarning(null)).toBe(false);
  });
});

describe("dropNodeProcessWarnings", () => {
  it("drops an event whose message is a process warning, as the console integration reports it", () => {
    expect(dropNodeProcessWarnings({ message: MAX_LISTENERS })).toBeNull();
  });

  it("drops it when the text is on the log entry or the exception instead", () => {
    expect(dropNodeProcessWarnings({ logentry: { message: MAX_LISTENERS } })).toBeNull();
    expect(dropNodeProcessWarnings({ exception: { values: [{ value: MAX_LISTENERS }] } })).toBeNull();
  });

  it("keeps everything else, untouched", () => {
    const real = { message: "Error: reminder scan failed", exception: { values: [{ value: "Error: boom" }] } };
    expect(dropNodeProcessWarnings(real)).toBe(real);
    const empty = {};
    expect(dropNodeProcessWarnings(empty)).toBe(empty);
  });
});
