import { describe, expect, it } from "vitest";
import { collectLegacyNameCandidates, legacyDisplayNameMatches } from "./legacy-name-match.js";

describe("legacyDisplayNameMatches", () => {
  it("matches exact and first-token names", () => {
    expect(legacyDisplayNameMatches("Mike", "Mike")).toBe(true);
    expect(legacyDisplayNameMatches("Mike Whobrey", "Mike")).toBe(true);
    expect(legacyDisplayNameMatches("riley", "Riley")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(legacyDisplayNameMatches("Ally", "Mike")).toBe(false);
  });
});

describe("collectLegacyNameCandidates", () => {
  it("includes email map, display name, and username", () => {
    const map = new Map([["me@mikewhob.com", "Mike"]]);
    const candidates = collectLegacyNameCandidates({
      email: "me@mikewhob.com",
      displayName: "Michael Whobrey",
      username: "riley",
      emailToLegacyName: map,
    });
    expect(candidates).toEqual(["Mike", "Michael Whobrey", "Michael", "riley"]);
  });
});
