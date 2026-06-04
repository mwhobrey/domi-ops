import { describe, expect, it } from "vitest";
import { applyCategoryMapping, eventCategoryColor } from "./categories.js";

describe("eventCategoryColor", () => {
  it("uses Google calendar color for events without colorId", () => {
    const color = eventCategoryColor({ summary: "Mike therapy" }, "#7986cb");
    expect(color).toBe("#7986cb");
  });

  it("uses event palette color when colorId is set", () => {
    const color = eventCategoryColor({ colorId: "10" }, "#7986cb");
    expect(color).toBe("#51b749");
  });

  it("uses Google event-type colors for working location", () => {
    const color = eventCategoryColor({ eventType: "workingLocation" }, "#7986cb");
    expect(color).toBe("#0ea5e9");
  });
});

describe("applyCategoryMapping", () => {  it("uses mapped target key and color", () => {
    const fields = { categoryKey: "focustime", color: null as string | null };
    const map = new Map([
      [
        "focustime",
        {
          sourceKey: "focustime",
          targetKey: "deep_work",
          targetLabel: "Deep work",
          targetColor: "#6366f1",
        },
      ],
    ]);
    applyCategoryMapping(fields, "focustime", map, "#2563eb");
    expect(fields.categoryKey).toBe("deep_work");
    expect(fields.color).toBe("#6366f1");
  });

  it("keeps Google event color when mapping has no targetColor", () => {
    const fields = { categoryKey: "google_color_5", color: "#f6bf26" as string | null };
    const map = new Map([
      [
        "google_color_5",
        {
          sourceKey: "google_color_5",
          targetKey: "meetings",
          targetLabel: "Meetings",
          targetColor: null,
        },
      ],
    ]);
    applyCategoryMapping(fields, "google_color_5", map, "#3b82f6");
    expect(fields.categoryKey).toBe("meetings");
    expect(fields.color).toBe("#f6bf26");
  });

  it("uses Google color when no import mapping exists", () => {
    const fields = { categoryKey: "google_color_9", color: "#5484ed" as string | null };
    applyCategoryMapping(fields, "google_color_9", new Map(), "#3b82f6");
    expect(fields.categoryKey).toBe("google_color_9");
    expect(fields.color).toBe("#5484ed");
  });

  it("keeps calendar-derived color when import mapping sets lane targetColor", () => {
    const fields = { categoryKey: "default", color: "#7986cb" as string | null };
    const map = new Map([
      [
        "default",
        {
          sourceKey: "default",
          targetKey: "family",
          targetLabel: "Family",
          targetColor: "#3b82f6",
        },
      ],
    ]);
    applyCategoryMapping(fields, "default", map, "#3b82f6");
    expect(fields.categoryKey).toBe("family");
    expect(fields.color).toBe("#7986cb");
  });

  it("resolves mappings using normalized source keys", () => {
    const fields = { categoryKey: "Default", color: null as string | null };
    const map = new Map([
      [
        "default",
        {
          sourceKey: "default",
          targetKey: "homeschool",
          targetLabel: "Homeschool",
          targetColor: "#33b679",
        },
      ],
    ]);
    applyCategoryMapping(fields, "Default", map, null);
    expect(fields.categoryKey).toBe("homeschool");
    expect(fields.color).toBe("#33b679");
  });
});