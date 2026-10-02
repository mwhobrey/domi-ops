import { describe, expect, it } from "vitest";
import { isUuid, isUuidList } from "./uuid.js";

const ID = "3fcd0c4c-1afe-42c0-914c-a712ad221c04";

describe("isUuid", () => {
  it("accepts UUIDs in either case", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
  });

  it("rejects everything else", () => {
    for (const bad of ["", "nope", "1", `${ID} `, ID.slice(1), `${ID}0`, "3fcd0c4c1afe42c0914ca712ad221c04", null, undefined, 5, {}, [ID]]) {
      expect(isUuid(bad), String(bad)).toBe(false);
    }
  });
});

describe("isUuidList", () => {
  it("accepts an empty list and lists of UUIDs", () => {
    expect(isUuidList([])).toBe(true);
    expect(isUuidList([ID])).toBe(true);
    expect(isUuidList([ID, ID.toUpperCase()])).toBe(true);
  });

  it("rejects non-arrays and arrays with any non-UUID element", () => {
    for (const bad of ["abc", ID, {}, { length: 1, 0: ID }, null, undefined, 5, [5], ["nope"], [ID, "nope"], [ID, null], [[ID]]]) {
      expect(isUuidList(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
