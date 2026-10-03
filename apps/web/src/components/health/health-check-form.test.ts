import { describe, expect, it } from "vitest";
import {
  BP_HEART_RATE_PRESET,
  checkDateRangeSummary,
  checkErrorMessage,
  checkScheduleSummary,
  checkTypeLabel,
  dateRangeError,
  emptyTemplateDraft,
  endDateHint,
  orderedMetrics,
  parseReminderOffsets,
  templateDraftToRequest,
  templateToDraft,
} from "./health-check-form";
import { medicationToScheduleDraft, scheduleDraftToRequestBody } from "./MedScheduleEditor";

describe("emptyTemplateDraft", () => {
  it("starts a vitals check on blood pressure and heart rate, and the rest empty", () => {
    expect(emptyTemplateDraft("vitals").metrics).toEqual(BP_HEART_RATE_PRESET);
    expect(emptyTemplateDraft("pain")).toEqual({ title: "", metrics: [], regions: [], activity: "" });
  });

  it("gives each draft its own list, so editing one never changes the preset", () => {
    const draft = emptyTemplateDraft("vitals");
    draft.metrics.push("weight");
    expect(BP_HEART_RATE_PRESET).toEqual(["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"]);
  });
});

describe("templateDraftToRequest", () => {
  const base = { title: "", metrics: [] as string[], regions: [] as string[], activity: "" };

  it("needs at least one reading for vitals, and keeps them in the app's order", () => {
    expect(templateDraftToRequest("vitals", base)).toEqual({
      ok: false,
      error: "Pick at least one reading to prompt for.",
    });
    expect(
      templateDraftToRequest("vitals", { ...base, metrics: ["heart_rate", "weight", "blood_pressure_systolic"] }),
    ).toEqual({ ok: true, template: { metrics: ["weight", "blood_pressure_systolic", "heart_rate"] } });
  });

  it("sends only the fields that belong to the type", () => {
    const filled = { title: "  Morning  ", metrics: ["weight"], regions: ["chest"], activity: "Walk" };
    expect(templateDraftToRequest("pain", filled)).toEqual({ ok: true, template: { title: "Morning", regions: ["chest"] } });
    expect(templateDraftToRequest("exercise", filled)).toEqual({ ok: true, template: { title: "Morning", activity: "Walk" } });
    expect(templateDraftToRequest("symptom", filled)).toEqual({ ok: true, template: { title: "Morning" } });
  });

  it("drops pain regions that are not real ones, including inherited names", () => {
    expect(
      templateDraftToRequest("pain", { ...base, regions: ["chest", "toString", "nope", "chest"] }),
    ).toEqual({ ok: true, template: { regions: ["chest"] } });
  });

  it("allows a pain check with no regions", () => {
    expect(templateDraftToRequest("pain", base)).toEqual({ ok: true, template: {} });
  });
});

describe("templateToDraft / orderedMetrics", () => {
  it("round-trips a stored template and tolerates a missing one", () => {
    expect(templateToDraft({ title: "T", metrics: ["weight"], regions: ["chest"], activity: "Walk" })).toEqual({
      title: "T",
      metrics: ["weight"],
      regions: ["chest"],
      activity: "Walk",
    });
    expect(templateToDraft(undefined)).toEqual({ title: "", metrics: [], regions: [], activity: "" });
  });

  it("orders and de-duplicates metrics", () => {
    expect(orderedMetrics(["heart_rate", "weight", "heart_rate"])).toEqual(["weight", "heart_rate"]);
  });
});

describe("parseReminderOffsets", () => {
  const ok = (offsets: number[]) => ({ ok: true, offsets });

  it("reads minutes before each time, ascending and without repeats", () => {
    expect(parseReminderOffsets("15, 0, 15, 60")).toEqual(ok([0, 15, 60]));
  });

  it("accepts spaces as well as commas, so \"15 30\" is two reminders and not one bad number", () => {
    expect(parseReminderOffsets("15 30")).toEqual(ok([15, 30]));
    expect(parseReminderOffsets("0,15 , 30")).toEqual(ok([0, 15, 30]));
  });

  it("means at the time itself when it is left blank", () => {
    expect(parseReminderOffsets("")).toEqual(ok([0]));
    expect(parseReminderOffsets("  ,  ")).toEqual(ok([0]));
  });

  it("refuses anything that is not a whole number of minutes, and names it", () => {
    for (const bad of ["15m", "-5", "1.5", "abc", "10, soon"]) {
      const result = parseReminderOffsets(bad);
      expect(result.ok, bad).toBe(false);
    }
    expect(parseReminderOffsets("15m")).toEqual({
      ok: false,
      error: "\"15m\" isn't a number of minutes. Use whole numbers like 0, 15.",
    });
    expect(parseReminderOffsets("10, soon")).toMatchObject({ ok: false, error: expect.stringContaining('"soon"') });
  });
});

describe("end date guidance", () => {
  it("nudges while there is no end date, and only then", () => {
    expect(endDateHint("")).toContain("usually have an end date");
    expect(endDateHint("   ")).not.toBeNull();
    expect(endDateHint("2026-10-16")).toBeNull();
  });

  it("rejects an end before the start, and allows either alone", () => {
    expect(dateRangeError("2026-10-16", "2026-10-02")).toBe("The end date is before the start date.");
    expect(dateRangeError("2026-10-02", "2026-10-16")).toBeNull();
    expect(dateRangeError("", "2026-10-16")).toBeNull();
    expect(dateRangeError("2026-10-02", "")).toBeNull();
  });
});

describe("summaries", () => {
  it("lists scheduled times and the days they apply on", () => {
    const every = checkScheduleSummary({ scheduleKind: "scheduled", schedule: { times: ["08:00", "20:00"] } });
    expect(every).toMatch(/8:00/);
    expect(every).toMatch(/8:00.*PM|20:00/);
    expect(every).not.toContain("·");
    expect(checkScheduleSummary({ scheduleKind: "scheduled", schedule: { times: ["08:00"], daysOfWeek: [1, 3] } })).toMatch(
      /· Mon, Wed$/,
    );
    // All seven is just "every day".
    expect(
      checkScheduleSummary({ scheduleKind: "scheduled", schedule: { times: ["08:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } }),
    ).not.toContain("·");
  });

  it("describes an interval in the largest whole unit", () => {
    expect(checkScheduleSummary({ scheduleKind: "interval", schedule: { everyMinutes: 240 } })).toBe("Every 4 hours");
    expect(checkScheduleSummary({ scheduleKind: "interval", schedule: { everyMinutes: 60 } })).toBe("Every hour");
    expect(checkScheduleSummary({ scheduleKind: "interval", schedule: { everyMinutes: 2880 } })).toBe("Every 2 days");
    expect(checkScheduleSummary({ scheduleKind: "interval", schedule: {} })).toBe("Repeats on an interval");
  });

  it("summarises the date range with whichever bounds exist", () => {
    expect(checkDateRangeSummary({ startDate: null, endDate: null })).toBeNull();
    expect(checkDateRangeSummary({ startDate: "2026-10-02", endDate: "2026-10-16" })).toMatch(/Oct 2 – Oct 16/);
    expect(checkDateRangeSummary({ startDate: "2026-10-02", endDate: null })).toMatch(/^from Oct 2$/);
    expect(checkDateRangeSummary({ startDate: null, endDate: "2026-10-16" })).toMatch(/^until Oct 16$/);
  });

  it("names types the way people say them", () => {
    expect(checkTypeLabel("food_intake")).toBe("Food");
    expect(checkTypeLabel("vitals")).toBe("Vitals");
    expect(checkTypeLabel("injury")).toBe("Injury");
  });
});

describe("the shared schedule draft keeps weekdays", () => {
  it("carries days from a stored schedule into the request, and omits them when none or all", () => {
    const draft = medicationToScheduleDraft({ scheduleKind: "scheduled", schedule: { times: ["08:00"], daysOfWeek: [3, 1] } });
    expect(draft.daysOfWeek).toEqual([3, 1]);
    expect(scheduleDraftToRequestBody(draft)).toEqual({
      ok: true,
      scheduleKind: "scheduled",
      schedule: { times: ["08:00"], daysOfWeek: [1, 3] },
    });
    expect(scheduleDraftToRequestBody({ ...draft, daysOfWeek: [] })).toMatchObject({ schedule: { times: ["08:00"] } });
    const everyDay = scheduleDraftToRequestBody({ ...draft, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    expect(everyDay).toEqual({ ok: true, scheduleKind: "scheduled", schedule: { times: ["08:00"] } });
  });

  it("defaults to every day for a source with none", () => {
    expect(medicationToScheduleDraft(null).daysOfWeek).toEqual([]);
  });
});

describe("checkErrorMessage", () => {
  const apiError = (code: string) => ({ body: JSON.stringify({ error: code }) });

  it("puts the API's error code in words", () => {
    expect(checkErrorMessage(apiError("template_requires_metrics"))).toBe("Pick at least one reading to prompt for.");
    expect(checkErrorMessage(apiError("end_before_start"))).toBe("The end date is before the start date.");
    expect(checkErrorMessage(apiError("scheduled_checks_require_times"))).toBe("Add at least one time.");
  });

  it("falls back for codes it does not know, and for anything that is not an API error", () => {
    expect(checkErrorMessage(apiError("something_new"))).toBe("Save failed");
    expect(checkErrorMessage(new Error("boom"), "Could not delete")).toBe("Could not delete");
    expect(checkErrorMessage({ body: "not json" })).toBe("Save failed");
    expect(checkErrorMessage(null)).toBe("Save failed");
  });
});
