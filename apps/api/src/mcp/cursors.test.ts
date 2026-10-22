import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpCursors } from "./cursors.js";

afterEach(() => vi.useRealTimers());
describe("MCP cursor integrity", () => {
  it("allows construction without a secret but refuses all cursor operations", () => {
    const unavailable = mcpCursors(undefined);
    expect(() => unavailable.encode("bound", "record")).toThrowError(expect.objectContaining({ code: "temporarily_unavailable", status: 503 }));
    expect(() => unavailable.decode("bound", "payload.signature")).toThrowError(expect.objectContaining({ code: "temporarily_unavailable", status: 503 }));
  });
  const cursors = mcpCursors("synthetic-test-secret-that-is-not-a-production-key");
  it("rejects modification, a different grant/query and a different signing key", () => {
    const cursor = cursors.encode("grant-a/shopping/open", "record-a");
    expect(cursors.decode("grant-a/shopping/open", cursor)).toBe("record-a");
    for (const binding of ["grant-b/shopping/open", "grant-a/chores/open", "grant-a/shopping/all"]) expect(() => cursors.decode(binding, cursor)).toThrow("invalid_cursor");
    expect(() => cursors.decode("grant-a/shopping/open", "x" + cursor)).toThrow("invalid_cursor");
    expect(() => mcpCursors("different-synthetic-secret").decode("grant-a/shopping/open", cursor)).toThrow("invalid_cursor");
  });
  it("expires continuations and rejects malformed payloads uniformly", () => {
    vi.useFakeTimers();
    const cursor = cursors.encode("bound", { offset: 123, revision: "example" });
    vi.advanceTimersByTime(3600001);
    expect(() => cursors.decode("bound", cursor)).toThrow("invalid_cursor");
    for (const malformed of ["", ".", "not-a-cursor", "e30.invalid.extra"]) expect(() => cursors.decode("bound", malformed)).toThrow("invalid_cursor");
  });
});
