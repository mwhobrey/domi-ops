import { describe, expect, it } from "vitest";
import {
  CHECK_EVENT_TYPES,
  CheckTemplateError,
  isCheckEventType,
  isIsoDate,
  normalizeCheckTemplate,
  parseCheckTemplate,
  validateCheckDateRange,
} from "./health-check-template.js";

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof CheckTemplateError ? e.code : "other";
  }
}

describe("check event types", () => {
  it("allows every logging group except medication", () => {
    for (const t of ["vitals", "pain", "food_intake", "exercise", "symptom", "sickness", "injury", "appointment", "other"]) {
      expect(isCheckEventType(t)).toBe(true);
    }
    expect(isCheckEventType("medication")).toBe(false);
    expect(isCheckEventType("nope")).toBe(false);
    expect(isCheckEventType(undefined)).toBe(false);
    expect(CHECK_EVENT_TYPES).not.toContain("medication");
  });
});

describe("normalizeCheckTemplate: vitals", () => {
  it("keeps the chosen metrics in order and drops duplicates", () => {
    expect(
      normalizeCheckTemplate("vitals", {
        metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate", "heart_rate"],
      }),
    ).toEqual({ metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"] });
  });

  it("requires at least one metric", () => {
    expect(codeOf(() => normalizeCheckTemplate("vitals", {}))).toBe("template_requires_metrics");
    expect(codeOf(() => normalizeCheckTemplate("vitals", undefined))).toBe("template_requires_metrics");
    expect(codeOf(() => normalizeCheckTemplate("vitals", { metrics: [] }))).toBe("template_requires_metrics");
  });

  it("rejects unknown metrics and non-list metrics", () => {
    expect(codeOf(() => normalizeCheckTemplate("vitals", { metrics: ["blood_pressure_systolic", "bogus"] }))).toBe(
      "unknown_vitals_metric",
    );
    expect(codeOf(() => normalizeCheckTemplate("vitals", { metrics: "heart_rate" }))).toBe("invalid_template_field");
    expect(codeOf(() => normalizeCheckTemplate("vitals", { metrics: [5] }))).toBe("unknown_vitals_metric");
  });
});

describe("normalizeCheckTemplate: other types", () => {
  it("does not require anything for pain, food, exercise or other", () => {
    expect(normalizeCheckTemplate("pain", undefined)).toEqual({});
    expect(normalizeCheckTemplate("food_intake", {})).toEqual({});
    expect(normalizeCheckTemplate("exercise", null)).toEqual({});
    expect(normalizeCheckTemplate("other", {})).toEqual({});
  });

  it("keeps pain regions that exist and rejects ones that do not", () => {
    expect(normalizeCheckTemplate("pain", { regions: ["lower_back", "left_hand", "lower_back"] })).toEqual({
      regions: ["lower_back", "left_hand"],
    });
    expect(normalizeCheckTemplate("pain", { regions: [] })).toEqual({});
    expect(codeOf(() => normalizeCheckTemplate("pain", { regions: ["elbow"] }))).toBe("unknown_pain_region");
  });

  it("keeps an exercise activity", () => {
    expect(normalizeCheckTemplate("exercise", { activity: "  Walk  " })).toEqual({ activity: "Walk" });
  });

  it("drops keys that do not belong to the type", () => {
    expect(normalizeCheckTemplate("pain", { metrics: ["heart_rate"], activity: "Walk", extra: 1 })).toEqual({});
    expect(normalizeCheckTemplate("exercise", { regions: ["lower_back"] })).toEqual({});
  });

  it("trims the default title and drops an empty one", () => {
    expect(normalizeCheckTemplate("other", { title: "  Evening check " })).toEqual({ title: "Evening check" });
    expect(normalizeCheckTemplate("other", { title: "   " })).toEqual({});
    expect(codeOf(() => normalizeCheckTemplate("other", { title: "x".repeat(121) }))).toBe("invalid_template_field");
    expect(codeOf(() => normalizeCheckTemplate("other", { title: 5 }))).toBe("invalid_template_field");
  });

  it("rejects a template that is not an object", () => {
    expect(codeOf(() => normalizeCheckTemplate("other", "x"))).toBe("invalid_template");
    expect(codeOf(() => normalizeCheckTemplate("other", []))).toBe("invalid_template");
    expect(codeOf(() => normalizeCheckTemplate("other", 3))).toBe("invalid_template");
  });
});

describe("parseCheckTemplate", () => {
  it("round-trips a normalized template", () => {
    const t = normalizeCheckTemplate("vitals", { title: "BP", metrics: ["heart_rate"] });
    expect(parseCheckTemplate(JSON.stringify(t))).toEqual(t);
  });

  it("never throws on junk", () => {
    expect(parseCheckTemplate(null)).toEqual({});
    expect(parseCheckTemplate("")).toEqual({});
    expect(parseCheckTemplate("{nope")).toEqual({});
    expect(parseCheckTemplate("null")).toEqual({});
    expect(parseCheckTemplate("[1]")).toEqual({});
    expect(parseCheckTemplate('{"metrics":"heart_rate"}')).toEqual({});
  });
});

describe("date validation", () => {
  it("recognises real ISO dates only", () => {
    expect(isIsoDate("2026-10-02")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("10/02/2026")).toBe(false);
    expect(isIsoDate(20261002)).toBe(false);
  });

  it("accepts open-ended, equal and ordered ranges", () => {
    expect(validateCheckDateRange(undefined, undefined)).toBeNull();
    expect(validateCheckDateRange("2026-10-02", null)).toBeNull();
    expect(validateCheckDateRange(null, "2026-10-16")).toBeNull();
    expect(validateCheckDateRange("2026-10-02", "2026-10-02")).toBeNull();
    expect(validateCheckDateRange("2026-10-02", "2026-10-16")).toBeNull();
  });

  it("rejects malformed dates and an end before the start", () => {
    expect(validateCheckDateRange("soon", null)).toBe("invalid_date");
    expect(validateCheckDateRange(null, "2026-02-30")).toBe("invalid_date");
    expect(validateCheckDateRange("2026-10-16", "2026-10-02")).toBe("end_before_start");
  });
});
