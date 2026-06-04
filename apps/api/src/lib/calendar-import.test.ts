import { describe, expect, it, vi } from "vitest";
import { normalizeHexColor, resolveTargetCalendar } from "./calendar-import.js";

describe("normalizeHexColor", () => {
  it("expands 3-digit hex", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
  });

  it("falls back on invalid input", () => {
    expect(normalizeHexColor("nope", "#112233")).toBe("#112233");
  });
});

describe("resolveTargetCalendar", () => {
  it("uses fallbackName when newCalendarName is empty", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            { id: "a", name: "Family", householdId: "h1" },
          ]),
        })),
      })),
      insert: vi.fn(),
    };
    const id = await resolveTargetCalendar(db as never, {
      householdId: "h1",
      ownerUserId: "u1",
      newCalendarName: "",
      fallbackName: "Family",
    });
    expect(id).toBe("a");
  });
});
