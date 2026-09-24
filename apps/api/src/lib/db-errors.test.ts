import { describe, expect, it } from "vitest";
import { isInvalidInputError } from "./db-errors.js";

describe("isInvalidInputError", () => {
  it("recognizes 22P02 directly and through a wrapped cause", () => {
    expect(isInvalidInputError({ code: "22P02" })).toBe(true);
    const wrapped = new Error("Failed query", { cause: { code: "22P02" } });
    expect(isInvalidInputError(wrapped)).toBe(true);
  });

  it("leaves other errors as server errors", () => {
    expect(isInvalidInputError(new Error("boom"))).toBe(false);
    expect(isInvalidInputError({ code: "23505" })).toBe(false);
    expect(isInvalidInputError(null)).toBe(false);
  });
});
