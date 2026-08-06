import { describe, expect, it } from "vitest";
import { buildShoppingGlance } from "./shopping-glance.js";

describe("buildShoppingGlance", () => {
  it("summarizes open items with aisle/qty meta", () => {
    const result = buildShoppingGlance([
      { id: "1", item: "Milk", checked: false, aisle: "Dairy", quantity: 1, unit: "gal" },
      { id: "2", item: "Eggs", checked: false, aisle: null, quantity: 12, unit: null },
      { id: "3", item: "Bread", checked: true, aisle: "Bakery", quantity: null, unit: null },
      { id: "4", item: "Apples", checked: false, aisle: "Produce", quantity: null, unit: null },
      { id: "5", item: "Soap", checked: false, aisle: null, quantity: null, unit: null },
    ]);
    expect(result.summary.headline).toBe("4 to buy");
    expect(result.summary.tone).toBe("default");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ item: "Milk", meta: "Dairy · 1 gal" });
    expect(result.items[1]).toMatchObject({ item: "Eggs", meta: "12" });
    expect(result.overflow).toBe(1);
  });

  it("returns success when list is clear", () => {
    const result = buildShoppingGlance([
      { id: "1", item: "Milk", checked: true, aisle: null, quantity: null, unit: null },
    ]);
    expect(result.summary.headline).toBe("List clear");
    expect(result.summary.tone).toBe("success");
    expect(result.items).toEqual([]);
    expect(result.overflow).toBe(0);
  });
});
