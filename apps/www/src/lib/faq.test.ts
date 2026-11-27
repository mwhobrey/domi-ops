import { describe, expect, it } from "vitest";
import { FAQ_ITEMS, faqJsonLd } from "./faq";

const CANCEL_Q = "What happens to my data if I cancel Cloud?";

describe("FAQ cancel answer", () => {
  it("says billing is through the web and only covers store purchases if they become available", () => {
    const item = FAQ_ITEMS.find((entry) => entry.q === CANCEL_Q);
    expect(item?.a).toContain("Billing is through the web");
    expect(item?.a).toContain("canceling renewal, in household Settings");
    expect(item?.a).toContain("If purchases through an app store become available");
    expect(item?.a).not.toContain("store subscriptions are managed through the store");
  });

  it("uses the same text in the FAQPage structured data", () => {
    const item = FAQ_ITEMS.find((entry) => entry.q === CANCEL_Q);
    const json = JSON.stringify(faqJsonLd(FAQ_ITEMS));
    expect(item).toBeDefined();
    expect(json).toContain(JSON.stringify(item?.a).slice(1, -1));
  });
});
