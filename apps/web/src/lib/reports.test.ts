import { describe, expect, it } from "vitest";
import { HEALTH_REPORT_KINDS } from "../../../api/src/lib/reports/types";
import { HEALTH_REPORT_FOCUS_OPTIONS } from "./health-report-export";
import { parseReportKind } from "./reports";

describe("report navigation", () => {
  it("recognizes every health report the API advertises and maps it to a pane", () => {
    for (const kind of HEALTH_REPORT_KINDS) {
      expect(parseReportKind(kind.id)).toBe(kind.id);
      expect(HEALTH_REPORT_FOCUS_OPTIONS.find((focus) => focus.id === kind.id)?.id).toBe(kind.id);
    }
  });

  it("keeps types after Medication list instead of falling back to Events", () => {
    for (const kind of ["exercise", "pain", "nutrition", "check-adherence", "blood-pressure", "trends"]) expect(parseReportKind(kind)).toBe(kind);
  });

  it("rejects invalid and inherited object keys", () => {
    for (const kind of [null, "", "made-up", "toString", "__proto__"]) expect(parseReportKind(kind)).toBeNull();
    expect(parseReportKind("school-transcript")).toBe("school-transcript");
  });
});
