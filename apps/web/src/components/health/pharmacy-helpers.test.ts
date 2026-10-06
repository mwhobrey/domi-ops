import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/client-api";
import {
  apiErrorCode,
  mapsSearchHref,
  medicationCountLabel,
  pharmacyErrorMessage,
  safeWebsiteHref,
  sortPharmacies,
  telHref,
} from "./pharmacy-helpers";
import type { Pharmacy } from "./supply-types";

const pharmacy = (name: string, archivedAt: string | null = null): Pharmacy => ({
  id: name,
  name,
  address: null,
  phone: null,
  phoneTel: null,
  website: null,
  notes: null,
  archivedAt,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  medicationCount: 0,
  medications: [],
  canEdit: true,
});

describe("telHref", () => {
  it("links a dialable number, with an extension", () => {
    expect(telHref("5551234567")).toBe("tel:5551234567");
    expect(telHref("+15551234567")).toBe("tel:+15551234567");
    expect(telHref("5551234567;ext=12")).toBe("tel:5551234567;ext=12");
  });

  it("refuses anything that is not a dialable number", () => {
    for (const bad of [null, undefined, "", "call me", "555", "5551234567;ext=", "5551234567;foo=1", "javascript:1", "1234567890123456", "55512 34567"]) {
      expect(telHref(bad), String(bad)).toBeNull();
    }
  });
});

describe("safeWebsiteHref", () => {
  it("links http and https addresses", () => {
    expect(safeWebsiteHref("https://walgreens.com/")).toBe("https://walgreens.com/");
    expect(safeWebsiteHref("http://example.com/rx")).toBe("http://example.com/rx");
  });

  it("refuses every other scheme and anything unparseable", () => {
    for (const bad of [null, undefined, "", "walgreens.com", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.co", "tel:5551234567", "file:///etc/passwd", "ftp://x.com", "//x.com"]) {
      expect(safeWebsiteHref(bad), String(bad)).toBeNull();
    }
  });
});

describe("mapsSearchHref", () => {
  it("encodes the address into a maps search", () => {
    expect(mapsSearchHref("1 Main St & 2nd, Springfield")).toBe(
      "https://www.google.com/maps/search/?api=1&query=1%20Main%20St%20%26%202nd%2C%20Springfield",
    );
  });

  it("has nothing to link without an address", () => {
    expect(mapsSearchHref(null)).toBeNull();
    expect(mapsSearchHref("   ")).toBeNull();
    expect(mapsSearchHref(undefined)).toBeNull();
  });
});

describe("medicationCountLabel", () => {
  it("reads naturally for none, one and many", () => {
    expect(medicationCountLabel(0)).toBe("No current medications");
    expect(medicationCountLabel(1)).toBe("1 current medication");
    expect(medicationCountLabel(4)).toBe("4 current medications");
    expect(medicationCountLabel(-1)).toBe("No current medications");
  });
});

describe("sortPharmacies", () => {
  it("puts active ones first, each by name, without changing the input", () => {
    const input = [pharmacy("Zed", "2026-02-01"), pharmacy("Beta"), pharmacy("Alpha", "2026-02-01"), pharmacy("Able")];
    const before = input.map((p) => p.name);
    expect(sortPharmacies(input).map((p) => p.name)).toEqual(["Able", "Beta", "Alpha", "Zed"]);
    expect(input.map((p) => p.name)).toEqual(before);
  });
});

describe("apiErrorCode and pharmacyErrorMessage", () => {
  const err = (status: number, body: string | undefined) => new ApiError(`API ${status}`, status, body);

  it("reads the code from the response body", () => {
    expect(apiErrorCode(err(400, JSON.stringify({ error: "invalid_website" })))).toBe("invalid_website");
  });

  it("finds no code in anything else", () => {
    expect(apiErrorCode(err(500, undefined))).toBeNull();
    expect(apiErrorCode(err(500, "not json"))).toBeNull();
    expect(apiErrorCode(err(500, JSON.stringify({ error: 5 })))).toBeNull();
    expect(apiErrorCode(new Error("boom"))).toBeNull();
    expect(apiErrorCode("invalid_website")).toBeNull();
  });

  it("turns a known code into a sentence and an unknown one into the fallback", () => {
    expect(pharmacyErrorMessage(err(400, JSON.stringify({ error: "invalid_phone" })), "Save failed")).toMatch(/7 to 15 digits/);
    expect(pharmacyErrorMessage(err(409, JSON.stringify({ error: "too_many_pharmacies" })), "Save failed")).toMatch(/100/);
    expect(pharmacyErrorMessage(err(400, JSON.stringify({ error: "something_new" })), "Save failed")).toBe("Save failed");
    expect(pharmacyErrorMessage(new Error("boom"), "Save failed")).toBe("Save failed");
  });
});
