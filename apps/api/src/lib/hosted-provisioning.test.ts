import { describe, expect, it } from "vitest";
import { pickReusableHousehold, siblingCustomerIds } from "./hosted-provisioning.js";

describe("siblingCustomerIds", () => {
  it("drops the current customer and keeps the rest", () => {
    expect(
      siblingCustomerIds([{ id: "cus_a" }, { id: "cus_b" }, { id: "cus_c" }], "cus_b"),
    ).toEqual(["cus_a", "cus_c"]);
  });

  it("returns empty when the only match is the current customer", () => {
    expect(siblingCustomerIds([{ id: "cus_a" }], "cus_a")).toEqual([]);
  });

  it("returns empty for no matches", () => {
    expect(siblingCustomerIds([], "cus_a")).toEqual([]);
  });
});

describe("pickReusableHousehold", () => {
  it("returns null when nothing matches (provision a new household)", () => {
    expect(
      pickReusableHousehold({
        byCurrentCustomer: null,
        byOwnerMembership: null,
        bySiblingCustomer: null,
      }),
    ).toBeNull();
  });

  it("prefers the exact-customer match over everything else", () => {
    expect(
      pickReusableHousehold({
        byCurrentCustomer: "hh_customer",
        byOwnerMembership: "hh_owner",
        bySiblingCustomer: "hh_sibling",
      }),
    ).toBe("hh_customer");
  });

  it("falls back to the signed-in user's existing household", () => {
    expect(
      pickReusableHousehold({
        byCurrentCustomer: null,
        byOwnerMembership: "hh_owner",
        bySiblingCustomer: "hh_sibling",
      }),
    ).toBe("hh_owner");
  });

  it("falls back to a sibling customer's household last", () => {
    expect(
      pickReusableHousehold({
        byCurrentCustomer: null,
        byOwnerMembership: null,
        bySiblingCustomer: "hh_sibling",
      }),
    ).toBe("hh_sibling");
  });
});
