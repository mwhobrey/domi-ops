import { describe, expect, it } from "vitest";
import { isInvalidInputError, isUniqueViolationError } from "./db-errors.js";

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

describe("isUniqueViolationError", () => {
  it("recognizes 23505 through a wrapped cause and nothing else", () => {
    expect(isUniqueViolationError(new Error("Failed query", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolationError({ code: "22P02" })).toBe(false);
    expect(isUniqueViolationError(undefined)).toBe(false);
  });
});
