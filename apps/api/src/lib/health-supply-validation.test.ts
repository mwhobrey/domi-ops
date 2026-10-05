import { describe, expect, it } from "vitest";
import {
  MAX_PILLS_PER_DOSE,
  SupplyValidationError,
  normalizeDoseTime,
  normalizePhone,
  normalizeWebsite,
  parsePillQuantity,
  quartersToPills,
} from "./health-supply-validation.js";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof SupplyValidationError) return e.code;
    throw e;
  }
};

describe("parsePillQuantity", () => {
  it("turns pills into whole quarters", () => {
    expect([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 10, 100].map(parsePillQuantity)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 40, 400]);
  });

  it("accepts the largest dose and nothing above it", () => {
    expect(parsePillQuantity(MAX_PILLS_PER_DOSE)).toBe(400);
    expect(codeOf(() => parsePillQuantity(100.25))).toBe("quantity_out_of_range");
    expect(codeOf(() => parsePillQuantity(101))).toBe("quantity_out_of_range");
  });

  it("refuses zero and negatives as out of range", () => {
    for (const bad of [0, -0, -1, -0.25]) expect(codeOf(() => parsePillQuantity(bad)), `${bad}`).toBe("quantity_out_of_range");
  });

  it("refuses anything that is not a quarter step, but forgives floating point noise", () => {
    for (const bad of [0.3, 0.1, 1.1, 1.33, 2.7, 0.249, 0.2501]) expect(codeOf(() => parsePillQuantity(bad)), `${bad}`).toBe("quantity_not_quarter_step");
    expect(parsePillQuantity(0.1 + 0.15)).toBe(1); // 0.25000000000000006
    expect(parsePillQuantity(1.1 + 0.4)).toBe(6); // 1.5000000000000002
  });

  it("refuses everything that is not a finite number", () => {
    for (const bad of ["1", "1.5", "", null, undefined, true, {}, [], [1], Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(codeOf(() => parsePillQuantity(bad)), String(bad)).toBe("invalid_quantity");
    }
  });
});

describe("quartersToPills", () => {
  it("is the inverse of parsePillQuantity for every valid step", () => {
    for (let q = 1; q <= 400; q++) expect(parsePillQuantity(quartersToPills(q))).toBe(q);
    expect(quartersToPills(6)).toBe(1.5);
  });
});

describe("normalizeDoseTime", () => {
  it("returns HH:MM, accepting :00 seconds and surrounding space", () => {
    expect(normalizeDoseTime("08:00")).toBe("08:00");
    expect(normalizeDoseTime(" 08:00:00 ")).toBe("08:00");
    expect(normalizeDoseTime("\n08:00\t")).toBe("08:00");
    expect(normalizeDoseTime("00:00")).toBe("00:00");
    expect(normalizeDoseTime("23:59")).toBe("23:59");
  });

  it("refuses anything that is not a whole-minute 24 hour clock time", () => {
    for (const bad of ["8:00", "24:00", "12:60", "08:00:30", "08:00:60", "noon", "", "08.00", "0800", "08:00pm", "08:\n00", "08:00\n:00", "08:00\u0000"]) {
      expect(codeOf(() => normalizeDoseTime(bad)), JSON.stringify(bad)).toBe("invalid_dose_time");
    }
    for (const bad of [null, undefined, 800, {}, ["08:00"]]) expect(codeOf(() => normalizeDoseTime(bad))).toBe("invalid_dose_time");
  });
});

describe("normalizeWebsite", () => {
  it("keeps http and https addresses", () => {
    expect(normalizeWebsite("https://www.cvs.com/store/123")).toBe("https://www.cvs.com/store/123");
    expect(normalizeWebsite("http://pharmacy.example.org")).toBe("http://pharmacy.example.org/");
    expect(normalizeWebsite("  https://walgreens.com  ")).toBe("https://walgreens.com/");
    expect(normalizeWebsite("HTTPS://Walgreens.COM/Refill?x=1#a")).toBe("https://walgreens.com/Refill?x=1#a");
  });

  it("adds https to a bare address", () => {
    expect(normalizeWebsite("walgreens.com")).toBe("https://walgreens.com/");
    expect(normalizeWebsite("www.cvs.com/refill")).toBe("https://www.cvs.com/refill");
    expect(normalizeWebsite("pharmacy.example.org:8443/portal")).toBe("https://pharmacy.example.org:8443/portal");
  });

  it("refuses every scheme that is not http or https, in any case or disguise", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "jAvAsCrIpT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "mailto:pharmacy@example.com",
      "tel:+15551234567",
      "file:///etc/passwd",
      "ftp://files.example.com",
      "blob:https://example.com/abc",
      "//evil.example.com",
      "/refill",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "javascript://example.com/%0aalert(1)",
    ]) {
      expect(codeOf(() => normalizeWebsite(bad)), JSON.stringify(bad)).toBe("invalid_website");
    }
  });

  it("refuses embedded credentials, spaces, control characters and hosts that are not real", () => {
    for (const bad of [
      "https://user:pass@example.com",
      "https://user@example.com",
      "https://exa mple.com",
      "https://example.com/a b",
      "https://example.com\u0000",
      "https://example.com/\u007f",
      "https://localhost",
      "https://cvs",
      "https://",
      "http:///path",
      "",
      "   ",
      "not a url",
      "https://" + "a".repeat(2050) + ".com",
    ]) {
      expect(codeOf(() => normalizeWebsite(bad)), JSON.stringify(bad.slice(0, 40))).toBe("invalid_website");
    }
    for (const bad of [null, undefined, 5, {}, ["https://example.com"]]) expect(codeOf(() => normalizeWebsite(bad))).toBe("invalid_website");
  });

  it("allows an IPv6 literal host", () => {
    expect(normalizeWebsite("http://[2001:db8::1]/refill")).toBe("http://[2001:db8::1]/refill");
  });
});

describe("normalizePhone", () => {
  it("makes a tel link from the usual ways of writing a number", () => {
    expect(normalizePhone("(555) 123-4567")).toEqual({ display: "(555) 123-4567", tel: "5551234567" });
    expect(normalizePhone("555.123.4567")).toEqual({ display: "555.123.4567", tel: "5551234567" });
    expect(normalizePhone("555 123 4567")).toMatchObject({ tel: "5551234567" });
    expect(normalizePhone("+1 (555) 123-4567")).toEqual({ display: "+1 (555) 123-4567", tel: "+15551234567" });
    expect(normalizePhone("  +44 20 7946 0958  ")).toEqual({ display: "+44 20 7946 0958", tel: "+442079460958" });
    expect(normalizePhone("123-4567")).toMatchObject({ tel: "1234567" });
    // Surrounding whitespace is trimmed, as everywhere else.
    expect(normalizePhone("555-123-4567\n")).toEqual({ display: "555-123-4567", tel: "5551234567" });
  });

  it("carries an extension in the form a tel link understands", () => {
    expect(normalizePhone("555-123-4567 x89")).toEqual({ display: "555-123-4567 x89", tel: "5551234567;ext=89" });
    expect(normalizePhone("555-123-4567 ext. 89")).toMatchObject({ tel: "5551234567;ext=89" });
    expect(normalizePhone("555-123-4567 Ext 89")).toMatchObject({ tel: "5551234567;ext=89" });
    expect(normalizePhone("555-123-4567 #123456")).toMatchObject({ tel: "5551234567;ext=123456" });
    expect(normalizePhone("+1 555 123 4567x7")).toMatchObject({ tel: "+15551234567;ext=7" });
  });

  it("accepts 7 to 15 digits and no others", () => {
    expect(normalizePhone("+123456789012345").tel).toBe("+123456789012345");
    for (const bad of ["123456", "1234567890123456", "+1234567890123456", "12-34-5", "x123"]) {
      expect(codeOf(() => normalizePhone(bad)), bad).toBe("invalid_phone");
    }
  });

  it("limits the length of what is stored even when the digits are fine", () => {
    // Ten digits, lots of padding: valid by digit count, but not something to keep.
    expect(normalizePhone("555" + " ".repeat(10) + "1234567").tel).toBe("5551234567");
    // 40 characters is the most, counting the padding.
    expect(normalizePhone("555" + " ".repeat(30) + "1234567").display).toHaveLength(40);
    expect(codeOf(() => normalizePhone("555" + " ".repeat(31) + "1234567"))).toBe("invalid_phone");
    expect(codeOf(() => normalizePhone("555" + " ".repeat(50) + "1234567"))).toBe("invalid_phone");
  });

  it("refuses letters, stray symbols, a plus in the middle, and a number that is only an extension", () => {
    for (const bad of [
      "1-800-FLOWERS",
      "call me maybe",
      "555-123-4567; rm -rf",
      "tel:5551234567",
      "555+123+4567",
      "555-123-4567 ext 1234567",
      "555-123-4567 x",
      "<script>",
      "555-123\n4567",
      "555\t123\t4567",
      "555-123-4567 x\n12",
      "",
      "   ",
      "+",
      "1".repeat(41),
    ]) {
      expect(codeOf(() => normalizePhone(bad)), JSON.stringify(bad)).toBe("invalid_phone");
    }
    for (const bad of [null, undefined, 5551234567, {}, ["555-123-4567"]]) expect(codeOf(() => normalizePhone(bad))).toBe("invalid_phone");
  });
});
