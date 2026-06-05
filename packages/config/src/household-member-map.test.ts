import { describe, expect, it } from "vitest";
import { parseHouseholdMemberEmailMap } from "./household-member-map.js";

describe("parseHouseholdMemberEmailMap", () => {
  it("parses legacy name to email pairs", () => {
    const map = parseHouseholdMemberEmailMap("Mom:mom@gmail.com, Kid:kid@gmail.com");
    expect(map.get("mom@gmail.com")).toBe("Mom");
    expect(map.get("kid@gmail.com")).toBe("Kid");
  });
});
