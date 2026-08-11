import { describe, expect, it } from "vitest";
import { budgetAlertMemberIds } from "./budget-alert-scan.js";

describe("budgetAlertMemberIds", () => {
  it("household scope returns all household members", () => {
    expect(
      budgetAlertMemberIds({
        ownerMemberId: null,
        writeShareMemberIds: ["ignored"],
        householdMemberIds: ["a", "b", "a"],
      }),
    ).toEqual(["a", "b"]);
  });

  it("personal scope returns owner + write sharees only", () => {
    expect(
      budgetAlertMemberIds({
        ownerMemberId: "owner",
        writeShareMemberIds: ["writer", "owner", "writer"],
        householdMemberIds: ["owner", "writer", "reader", "other"],
      }),
    ).toEqual(["owner", "writer"]);
  });

  it("personal with no shares notifies owner only", () => {
    expect(
      budgetAlertMemberIds({
        ownerMemberId: "owner",
        writeShareMemberIds: [],
        householdMemberIds: ["owner", "other"],
      }),
    ).toEqual(["owner"]);
  });
});
